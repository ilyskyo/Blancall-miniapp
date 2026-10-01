import { Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { AppError } from '../common/errors';
import {
  decodeEntities,
  decodeText,
  extractDocText,
  guessTitle,
  stripBom,
  stripHtml,
  stripRtf,
  toParagraphs,
} from './text.util';
import { extractZipEntries } from './zip.util';

export interface ParsedDocument {
  title: string;
  paragraphs: string[];
  plainText: string;
}

/** 去掉扩展名的文件名 */
function baseName(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

function matchHtmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = decodeEntities(m[1]).trim();
  return t === '' ? null : t;
}

/**
 * 文档解析（后端解析，替代 Android 端 PDFBox 等端侧能力）
 * txt/md 直读；pdf 用 pdf-parse；docx 用 mammoth；
 * doc/epub/rtf/html 尽力解析（OLE2 启发式 / 内置 ZIP 读取 / 正则清洗）。
 */
@Injectable()
export class DocumentParserService {
  async parse(buffer: Buffer, ext: string, filename: string): Promise<ParsedDocument> {
    const e = ext.toLowerCase().replace(/^\./, '');
    switch (e) {
      case 'txt':
      case 'text':
      case 'md':
      case 'markdown':
        return this.fromPlainText(buffer, filename);
      case 'html':
      case 'htm': {
        const html = decodeText(buffer);
        return this.build(stripHtml(html), matchHtmlTitle(html) ?? baseName(filename), filename);
      }
      case 'rtf':
        return this.build(stripRtf(decodeText(buffer)), baseName(filename), filename);
      case 'pdf':
        return this.fromPdf(buffer, filename);
      case 'docx':
        return this.fromDocx(buffer, filename);
      case 'doc':
        return this.build(extractDocText(buffer), baseName(filename), filename);
      case 'epub':
        return this.fromEpub(buffer, filename);
      default:
        throw AppError.invalidArgument(`暂不支持的文件类型：.${e}`);
    }
  }

  private build(text: string, title: string, filename: string): ParsedDocument {
    const paragraphs = toParagraphs(stripBom(text ?? ''));
    const plainText = paragraphs.join('\n');
    if (plainText.trim() === '') {
      throw AppError.upstreamFailed('解析结果为空，文件可能是扫描件、加密文件或纯图片');
    }
    const finalTitle = (title && title.trim() !== '' ? title.trim() : guessTitle(plainText, baseName(filename)))
      .slice(0, 120);
    return { title: finalTitle, paragraphs, plainText };
  }

  private fromPlainText(buffer: Buffer, filename: string): ParsedDocument {
    const text = decodeText(buffer);
    // 标题统一取文件名（避免与正文首行重复）
    return this.build(text, baseName(filename), filename);
  }

  private async fromPdf(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    try {
      const res = await pdfParse(buffer);
      const infoTitle = res.info && typeof res.info.Title === 'string' ? res.info.Title : '';
      return this.build(res.text ?? '', infoTitle || baseName(filename), filename);
    } catch (err) {
      throw AppError.upstreamFailed(`PDF 解析失败：${(err as Error).message}`);
    }
  }

  private async fromDocx(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    try {
      const res = await mammoth.extractRawText({ buffer });
      return this.build(res.value ?? '', baseName(filename), filename);
    } catch (err) {
      throw AppError.upstreamFailed(`DOCX 解析失败：${(err as Error).message}`);
    }
  }

  private async fromEpub(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    let entries: Array<{ name: string; data: Buffer }>;
    try {
      entries = extractZipEntries(buffer);
    } catch (err) {
      throw AppError.upstreamFailed(`EPUB 解析失败：${(err as Error).message}`);
    }
    const htmlEntries = entries
      .filter((en) => /\.(x?html?|htm)$/i.test(en.name))
      .filter((en) => !/(^|\/)(nav|toc|cover)\b/i.test(en.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (htmlEntries.length === 0) {
      throw AppError.upstreamFailed('EPUB 内未找到可解析的 HTML 内容');
    }
    const parts = htmlEntries.map((en) => stripHtml(decodeText(en.data)));
    const firstHtml = decodeText(htmlEntries[0].data);
    return this.build(parts.join('\n\n'), matchHtmlTitle(firstHtml) ?? baseName(filename), filename);
  }
}