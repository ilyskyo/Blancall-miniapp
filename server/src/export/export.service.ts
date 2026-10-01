import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { cnDateString, dateToCnString, toMs } from '../common/time.util';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import { toParagraphs } from '../uploads/text.util';
import type { CsvBody, PdfBody } from './export.dto';

export interface ExportResult {
  fileUrl: string;
  expireAt: number;
}

// ---------------------------------------------------------------- CSV 工具

/** RFC4180 转义 */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60) || 'export';
}

// ---------------------------------------------------------------- 试卷挖空（后端简化算法）

function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?…])/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function makeWorksheet(paragraph: string, mode: string): string {
  if (mode === 'REVERSE') {
    const len = Math.min(Math.max(paragraph.length, 6), 40);
    return '＿'.repeat(len);
  }
  if (mode === 'SENTENCE') {
    const sentences = splitSentences(paragraph);
    if (sentences.length <= 1) return paragraph;
    return sentences.map((s, i) => (i % 2 === 1 ? '（＿＿＿＿＿＿）' : s)).join('');
  }
  // WORD：按位置确定性挖去部分汉字
  let out = '';
  let idx = 0;
  for (const ch of paragraph) {
    out += isCjk(ch) && idx % 4 === 2 ? '＿' : ch;
    idx += 1;
  }
  return out;
}

/**
 * 导出：CSV（练习记录）/ A4 PDF 试卷 / 个人数据备份 JSON
 * 均写入对象存储并返回签名 fileUrl + expireAt（默认 10 分钟）。
 */
@Injectable()
export class ExportService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  /** POST /export/csv —— 练习记录 CSV（UTF-8 BOM + RFC4180） */
  async csv(userId: string, body: CsvBody): Promise<ExportResult> {
    const rows = await this.prisma.entity.findMany({
      where: { userId, entity: 'practice_record', deleted: false },
      orderBy: { updatedAt: 'asc' },
    });

    interface RecordPayload {
      articleUuid?: string;
      articleTitle?: string;
      mode?: string;
      totalBlanks?: number;
      correctCount?: number;
      similarity?: number;
      rating?: number;
      duration?: number;
      weakHints?: number;
      strongHints?: number;
      timestamp?: number;
      mistakes?: Array<Record<string, unknown>>;
    }

    let records = rows.map((r) => (r.payload ?? {}) as RecordPayload);

    const filter = body.filter ?? {};
    if (filter.articleUuid) {
      records = records.filter((r) => r.articleUuid === filter.articleUuid);
    }
    if (typeof filter.from === 'number') {
      records = records.filter((r) => Number(r.timestamp ?? 0) >= filter.from!);
    }
    if (typeof filter.to === 'number') {
      records = records.filter((r) => Number(r.timestamp ?? 0) <= filter.to!);
    }
    records.sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));

    const header = [
      '时间',
      '文章',
      '模式',
      '总空数',
      '正确数',
      '正确率',
      '相似度',
      '评级',
      '用时(秒)',
      '弱提示',
      '强提示',
      '错题数',
      '错题明细',
    ];

    const lines: string[] = [header.map(csvCell).join(',')];
    for (const r of records) {
      const total = Number(r.totalBlanks ?? 0);
      const correct = Number(r.correctCount ?? 0);
      const accuracy = total > 0 ? (correct / total).toFixed(4) : '0';
      const mistakes = Array.isArray(r.mistakes) ? r.mistakes : [];
      const detail = mistakes
        .map((m) => `${m.correctAnswer ?? ''}→${m.userAnswer ?? ''}(${m.errorType ?? ''})`)
        .join('; ');
      lines.push(
        [
          r.timestamp ? new Date(Number(r.timestamp)).toISOString() : '',
          r.articleTitle ?? r.articleUuid ?? '',
          r.mode ?? '',
          total,
          correct,
          accuracy,
          r.similarity ?? '',
          r.rating ?? '',
          r.duration ?? '',
          r.weakHints ?? 0,
          r.strongHints ?? 0,
          mistakes.length,
          detail,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    // UTF-8 BOM 便于 Excel 正确识别中文
    const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
    return this.saveAndSign(
      userId,
      `practice-records-${cnDateString()}.csv`,
      Buffer.from(csv, 'utf8'),
      'text/csv; charset=utf-8',
    );
  }

  /** POST /export/pdf —— A4 试卷（可选答案页） */
  async pdf(userId: string, body: PdfBody): Promise<ExportResult> {
    const entity = await this.prisma.entity.findFirst({
      where: { userId, entity: 'article', uuid: body.articleUuid, deleted: false },
    });
    if (!entity) throw AppError.notFound('文章不存在');

    const payload = (entity.payload ?? {}) as Record<string, unknown>;
    const title = typeof payload.title === 'string' ? payload.title : '未命名文章';
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (content.trim() === '') throw AppError.invalidArgument('文章内容为空，无法导出');

    const buffer = await this.buildPdf(title, content, body.mode, body.includeAnswers);
    return this.saveAndSign(
      userId,
      `${sanitizeFilename(title)}-${Date.now()}.pdf`,
      buffer,
      'application/pdf',
    );
  }

  /** POST /export/backup —— 个人数据备份 JSON（数据可携合规） */
  async backup(userId: string): Promise<ExportResult> {
    const [user, entities, checkins, sessions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          nickname: true,
          avatar: true,
          rankVisible: true,
          credits: true,
          streakCurrent: true,
          streakLongest: true,
          createdAt: true,
        },
      }),
      this.prisma.entity.findMany({ where: { userId }, orderBy: { rev: 'asc' } }),
      this.prisma.checkin.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      this.prisma.aiSession.findMany({
        where: { userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      }),
    ]);

    const data = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      user: user
        ? {
            id: user.id,
            nickname: user.nickname,
            avatar: user.avatar,
            rankVisible: user.rankVisible,
            credits: user.credits,
            streakCurrent: user.streakCurrent,
            streakLongest: user.streakLongest,
            createdAt: user.createdAt.getTime(),
          }
        : null,
      entities: entities.map((e) => ({
        entity: e.entity,
        uuid: e.uuid,
        op: e.op,
        payload: e.payload,
        rev: Number(e.rev),
        updatedAt: e.updatedAt.getTime(),
        deleted: e.deleted,
      })),
      checkins: checkins.map((c) => ({
        date: dateToCnString(c.date),
        creditsDelta: c.creditsDelta,
        streakAfter: c.streakAfter,
        createdAt: c.createdAt.getTime(),
      })),
      aiSessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt.getTime(),
        updatedAt: toMs(s.updatedAt),
        messages: s.messages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.getTime(),
        })),
      })),
    };

    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    return this.saveAndSign(
      userId,
      `blancall-backup-${cnDateString()}.json`,
      buffer,
      'application/json; charset=utf-8',
    );
  }

  // ---------------------------------------------------------------- 内部

  private async saveAndSign(
    userId: string,
    filename: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<ExportResult> {
    const key = `exports/${userId}/${Date.now()}-${filename}`;
    await this.storage.put(key, buffer, contentType);
    const signed = await this.storage.getSignedUrl(key, this.cfg.exportTtlSec);
    return { fileUrl: signed.url, expireAt: signed.expireAt };
  }

  /** 生成 A4 试卷 PDF（中文使用内置 STSong-Light，不可用时回落 Helvetica） */
  private buildPdf(
    title: string,
    content: string,
    mode: string,
    includeAnswers: boolean,
  ): Promise<Buffer> {
    // @types/pdfkit 把模块导出声明为实例（export = doc），这里显式转为构造函数
    const PdfCtor = PDFDocument as unknown as new (
      options?: Record<string, unknown>,
    ) => PDFKit.PDFDocument;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PdfCtor({
        size: 'A4',
        margins: { top: 56, bottom: 56, left: 56, right: 56 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let fontName = 'STSong-Light';
      try {
        doc.font(fontName);
      } catch {
        fontName = 'Helvetica';
        doc.font(fontName);
      }

      const paragraphs = toParagraphs(content);

      // 卷首
      doc.font(fontName).fontSize(18).fillColor('#000000').text(title, { align: 'center' });
      doc.moveDown(0.4);
      doc
        .fontSize(9)
        .fillColor('#666666')
        .text(
          `模式：${mode}　导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
          { align: 'center' },
        );
      doc.moveDown(1);

      // 试题
      doc.fillColor('#000000').fontSize(13);
      for (const p of paragraphs) {
        doc.text(makeWorksheet(p, mode), { lineGap: 6 });
        doc.moveDown(0.5);
      }

      // 答案页
      if (includeAnswers) {
        doc.addPage();
        doc.fontSize(16).text('参考答案', { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(13);
        for (const p of paragraphs) {
          doc.text(p, { lineGap: 6 });
          doc.moveDown(0.5);
        }
      }

      doc.end();
    });
  }
}