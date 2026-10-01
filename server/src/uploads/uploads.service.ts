import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors';
import { FREE_SPACE_BYTES } from '../common/features';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import { contentTypeByExt } from '../storage/signature.util';
import { WechatSecurityService } from '../wechat/wechat-security.service';
import { DocumentParserService, type ParsedDocument } from './document-parser.service';
import { FontParserService } from './font-parser.service';
import { decodeText } from './text.util';

export const DOC_MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const FONT_MAX_BYTES = 20 * 1024 * 1024; // 20MB
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB

export const DOC_EXTS = ['txt', 'text', 'md', 'markdown', 'pdf', 'docx', 'doc', 'epub', 'rtf', 'html', 'htm'];
export const FONT_EXTS = ['ttf', 'otf'];
export const AVATAR_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

/** 可在上传阶段直接做语义送检的文本类格式 */
const TEXT_EXTS = ['txt', 'text', 'md', 'markdown', 'html', 'htm', 'rtf'];

function extOfName(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx < 0 ? '' : name.slice(idx + 1).toLowerCase();
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly security: WechatSecurityService,
    private readonly docParser: DocumentParserService,
    private readonly fontParser: FontParserService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------ 文档

  /** 上传文档：登录 → 空间配额 →（PDF 权益）→ 存储 → 内容安全（文本类） */
  async uploadDocument(
    userId: string,
    openid: string,
    file: Express.Multer.File | undefined,
  ): Promise<{
    id: string;
    name: string;
    ext: string;
    size: number;
    status: string;
    securitySkipped: boolean;
  }> {
    if (!file) throw AppError.invalidArgument('缺少上传文件（字段名 file）');
    const ext = extOfName(file.originalname);
    if (!DOC_EXTS.includes(ext)) {
      throw AppError.invalidArgument(`不支持的文档类型 .${ext}，支持：${DOC_EXTS.join('/')}`);
    }
    if (file.size > DOC_MAX_BYTES) throw AppError.invalidArgument('文档超过 50MB 上限');

    // 空间配额
    await this.assertSpace(userId, file.size);

    // 内容安全：文本类直接送检；二进制类在 /parse 阶段对解析结果送检
    let securitySkipped = true;
    if (TEXT_EXTS.includes(ext)) {
      const text = decodeText(file.buffer).slice(0, 2500);
      const result = await this.security.assertText(text, openid);
      securitySkipped = result.skipped;
    }

    const id = randomUUID();
    const storageKey = `documents/${userId}/${id}.${ext}`;
    await this.storage.put(storageKey, file.buffer, contentTypeByExt(ext));

    const created = await this.prisma.upload.create({
      data: {
        id,
        userId,
        kind: 'document',
        name: file.originalname,
        ext,
        mime: file.mimetype ?? null,
        sizeBytes: BigInt(file.size),
        storageKey,
        status: 'uploaded',
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { spaceBytesUsed: { increment: BigInt(file.size) } },
    });

    return {
      id: created.id,
      name: created.name,
      ext: created.ext,
      size: file.size,
      status: created.status,
      securitySkipped,
    };
  }

  async listDocuments(userId: string) {
    const rows = await this.prisma.upload.findMany({
      where: { userId, kind: 'document' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ext: r.ext,
      size: Number(r.sizeBytes),
      status: r.status,
      createdAt: r.createdAt.getTime(),
    }));
  }

  /** 删除文档（释放空间） */
  async deleteDocument(userId: string, id: string): Promise<{ deleted: true }> {
    const row = await this.findOwn(userId, id, 'document');
    await this.storage.delete(row.storageKey);
    await this.deleteParsedCache(userId, id);
    await this.prisma.upload.delete({ where: { id } });
    await this.releaseSpace(userId, Number(row.sizeBytes));
    return { deleted: true };
  }

  /**
   * 解析文档 → { title, paragraphs[], plainText }
   * - 结果缓存在对象存储（parsed/<userId>/<id>.json），DB 只存元数据（避免超大 JSONB）
   * - 解析结果送内容安全检测；PDF 需要 pdf_import 权益
   */
  async parseDocument(
    userId: string,
    openid: string,
    id: string,
  ): Promise<ParsedDocument & { securitySkipped: boolean }> {
    const row = await this.findOwn(userId, id, 'document');

    // 命中缓存
    const meta = row.parsed as
      | { title?: string; paragraphCount?: number; charCount?: number; parsedKey?: string }
      | null;
    if (row.status === 'parsed' && meta?.parsedKey) {
      try {
        const cached = await this.storage.get(meta.parsedKey);
        const parsed = JSON.parse(cached.toString('utf8')) as ParsedDocument;
        return { ...parsed, securitySkipped: false };
      } catch {
        this.logger.warn(`解析缓存读取失败，重新解析 uploadId=${id}`);
      }
    }

    try {
      const buf = await this.storage.get(row.storageKey);
      const parsed = await this.docParser.parse(buf, row.ext, row.name);

      // 解析结果送内容安全（取前 2500 字，满足微信限制）
      const result = await this.security.assertText(parsed.plainText.slice(0, 2500), openid);

      const parsedKey = this.parsedKey(userId, id);
      await this.storage.put(
        parsedKey,
        Buffer.from(JSON.stringify(parsed), 'utf8'),
        'application/json; charset=utf-8',
      );
      await this.prisma.upload.update({
        where: { id },
        data: {
          status: 'parsed',
          parsed: {
            title: parsed.title,
            paragraphCount: parsed.paragraphs.length,
            charCount: parsed.plainText.length,
            parsedKey,
          },
        },
      });
      return { ...parsed, securitySkipped: result.skipped };
    } catch (e) {
      await this.prisma.upload
        .update({ where: { id }, data: { status: 'failed' } })
        .catch(() => undefined);
      throw e;
    }
  }

  // ------------------------------------------------------------ 头像

  /**
   * 头像上传转存：≤2MB，仅 jpg/png/webp
   * 小程序「头像昵称填写」得到的是临时路径，下次启动即失效；必须先转存到对象存储再保存 URL。
   * 返回 URL 由存储驱动决定（local 为签名 URL，s3 为预签名/公开 URL）。
   *
   * 空间与记录：头像同样计入空间配额并登记 uploads（kind='avatar'）；
   * 更换头像时删除上一张并释放其占用，避免头像无限累积（曾出现的缺陷）。
   */
  async uploadAvatar(userId: string, file: Express.Multer.File | undefined): Promise<{ url: string }> {
    if (!file) throw AppError.invalidArgument('缺少上传文件（字段名 file）');
    const ext = extOfName(file.originalname);
    if (!AVATAR_EXTS.includes(ext)) {
      throw AppError.invalidArgument(`头像仅支持 ${AVATAR_EXTS.join('/')} 格式`);
    }
    if (file.size <= 0) throw AppError.invalidArgument('头像文件为空');
    if (file.size > AVATAR_MAX_BYTES) throw AppError.invalidArgument('头像超过 2MB 上限');
    await this.assertSpace(userId, file.size);

    // 释放上一张头像（存储 + 空间 + 记录）
    const previous = await this.prisma.upload.findFirst({
      where: { userId, kind: 'avatar' },
      orderBy: { createdAt: 'desc' },
    });
    if (previous) {
      await this.storage.delete(previous.storageKey).catch(() => undefined);
      await this.releaseSpace(userId, Number(previous.sizeBytes));
      await this.prisma.upload.delete({ where: { id: previous.id } });
    }

    const id = randomUUID();
    const storageKey = `avatars/${userId}/${id}.${ext}`;
    await this.storage.put(storageKey, file.buffer, contentTypeByExt(ext));

    // 登记并占用空间（与文档/字体一致的口径）
    await this.prisma.upload.create({
      data: {
        id,
        userId,
        kind: 'avatar',
        name: file.originalname || `avatar.${ext}`,
        ext,
        sizeBytes: BigInt(file.size),
        storageKey,
        status: 'uploaded',
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { spaceBytesUsed: { increment: BigInt(file.size) } },
    });

    const signed = await this.storage.getSignedUrl(storageKey);
    return { url: signed.url };
  }

  // ------------------------------------------------------------ 字体

  /** 上传字体：类型/大小/魔数校验 + name 表家族名解析 */
  async uploadFont(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ id: string; family: string; url: string }> {
    if (!file) throw AppError.invalidArgument('缺少上传文件（字段名 file）');
    const ext = extOfName(file.originalname);
    if (!FONT_EXTS.includes(ext)) {
      throw AppError.invalidArgument('字体仅支持 .ttf / .otf（不支持 .ttc）');
    }
    if (file.size > FONT_MAX_BYTES) throw AppError.invalidArgument('字体超过 20MB 上限');

    const info = this.fontParser.validate(file.buffer);
    await this.assertSpace(userId, file.size);

    const id = randomUUID();
    const storageKey = `fonts/${userId}/${id}.${ext}`;
    const contentType = ext === 'ttf' ? 'font/ttf' : 'font/otf';
    await this.storage.put(storageKey, file.buffer, contentType);

    await this.prisma.upload.create({
      data: {
        id,
        userId,
        kind: 'font',
        name: file.originalname,
        ext,
        mime: file.mimetype ?? contentType,
        sizeBytes: BigInt(file.size),
        storageKey,
        status: 'uploaded',
        family: info.family,
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { spaceBytesUsed: { increment: BigInt(file.size) } },
    });

    const signed = await this.storage.getSignedUrl(storageKey);
    return { id, family: info.family, url: signed.url };
  }

  async listFonts(userId: string) {
    const rows = await this.prisma.upload.findMany({
      where: { userId, kind: 'font' },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      rows.map(async (r) => {
        const signed = await this.storage.getSignedUrl(r.storageKey);
        return {
          id: r.id,
          name: r.name,
          family: r.family,
          ext: r.ext,
          size: Number(r.sizeBytes),
          url: signed.url,
          expireAt: signed.expireAt,
          createdAt: r.createdAt.getTime(),
        };
      }),
    );
  }

  async deleteFont(userId: string, id: string): Promise<{ deleted: true }> {
    const row = await this.findOwn(userId, id, 'font');
    await this.storage.delete(row.storageKey);
    await this.prisma.upload.delete({ where: { id } });
    await this.releaseSpace(userId, Number(row.sizeBytes));
    return { deleted: true };
  }

  // ------------------------------------------------------------ 内部

  private async findOwn(userId: string, id: string, kind: 'document' | 'font') {
    const row = await this.prisma.upload.findFirst({ where: { id, userId, kind } });
    if (!row) throw AppError.notFound(kind === 'font' ? '字体不存在' : '文档不存在');
    return row;
  }

  private parsedKey(userId: string, id: string): string {
    return `parsed/${userId}/${id}.json`;
  }

  private async deleteParsedCache(userId: string, id: string): Promise<void> {
    try {
      await this.storage.delete(this.parsedKey(userId, id));
    } catch {
      // 忽略缓存清理失败
    }
  }

  private async assertSpace(userId: string, addBytes: number): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const used = user ? Number(user.spaceBytesUsed) : 0;
    if (used + addBytes > FREE_SPACE_BYTES) {
      throw AppError.spaceQuotaExceeded(addBytes, used, FREE_SPACE_BYTES);
    }
  }

  private async releaseSpace(userId: string, bytes: number): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const next = Number(user.spaceBytesUsed) - bytes;
    await this.prisma.user.update({
      where: { id: userId },
      data: { spaceBytesUsed: BigInt(Math.max(0, next)) },
    });
  }
}