import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { decodeEntities } from '../uploads/text.util';

export interface LibraryIndexItem {
  no: number;
  title: string;
}

/** gaokao 篇目总数（p1..p60） */
const LIBRARY_TOTAL = 60;

/**
 * 素材库（gaokao 文本）
 * 仅提供纯文本（pN.txt），不提供 PDF（D15）。
 * 目录与正文按需从 assets 目录读取并内存缓存；对游客开放（属免费功能）。
 */
@Injectable()
export class LibraryService {
  private readonly dir: string;
  private titleCache: Map<number, string> | null = null;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.dir = this.resolveDir(cfg.gaokaoDir);
  }

  /** 依次尝试：配置目录 → 构建产物内 assets → 源码 assets → 进程工作目录 assets */
  private resolveDir(configured: string): string {
    const candidates = [
      configured,
      path.join(__dirname, '..', 'assets', 'gaokao'),
      path.join(__dirname, '..', '..', 'assets', 'gaokao'),
      path.join(process.cwd(), 'assets', 'gaokao'),
    ].filter((p) => typeof p === 'string' && p !== '');

    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
      } catch {
        // 忽略探测失败
      }
    }
    return path.join(process.cwd(), 'assets', 'gaokao');
  }

  private txtPath(no: number): string {
    return path.join(this.dir, `p${no}.txt`);
  }

  /** 标题表：优先 index.html，缺失则回落 pN.txt 首行 */
  private titles(): Map<number, string> {
    if (this.titleCache) return this.titleCache;
    const map = new Map<number, string>();

    try {
      const html = fs.readFileSync(path.join(this.dir, 'index.html'), 'utf8');
      const re = /href="p(\d+)\.pdf"[^>]*>[\s\S]*?<span class="t">([\s\S]*?)<\/span>/gi;
      let m: RegExpExecArray | null = re.exec(html);
      while (m !== null) {
        const no = Number.parseInt(m[1], 10);
        const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
        if (Number.isFinite(no) && title !== '') map.set(no, title);
        m = re.exec(html);
      }
    } catch {
      // index.html 不存在时使用文件名兜底
    }

    for (let no = 1; no <= LIBRARY_TOTAL; no += 1) {
      if (map.has(no)) continue;
      try {
        const raw = fs.readFileSync(this.txtPath(no), 'utf8');
        const first = raw
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l !== '');
        if (first) map.set(no, first);
      } catch {
        // 该篇缺失
      }
    }

    this.titleCache = map;
    return map;
  }

  /** GET /library/gaokao/index */
  index(): LibraryIndexItem[] {
    const titles = this.titles();
    const items: LibraryIndexItem[] = [];
    for (let no = 1; no <= LIBRARY_TOTAL; no += 1) {
      const title = titles.get(no);
      if (title && fs.existsSync(this.txtPath(no))) items.push({ no, title });
    }
    if (items.length === 0) {
      throw AppError.upstreamFailed(`素材库为空：未在 ${this.dir} 找到 p1..p60.txt`);
    }
    return items;
  }

  /** GET /library/gaokao/:no */
  get(noRaw: string): { no: number; title: string; text: string } {
    const no = Number.parseInt(noRaw, 10);
    if (!Number.isInteger(no) || no < 1 || no > LIBRARY_TOTAL) {
      throw AppError.invalidArgument(`篇目序号应为 1..${LIBRARY_TOTAL}`);
    }
    const file = this.txtPath(no);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      throw AppError.notFound(`第 ${no} 篇不存在`);
    }

    const title = this.titles().get(no) ?? `第 ${no} 篇`;
    // 正文首行若与标题重复，则去掉
    const lines = raw.split(/\r?\n/);
    const firstIdx = lines.findIndex((l) => l.trim() !== '');
    if (firstIdx >= 0 && lines[firstIdx].trim() === title) {
      lines.splice(firstIdx, 1);
    }
    const text = lines.join('\n').replace(/^\n+/, '');

    return { no, title, text };
  }
}