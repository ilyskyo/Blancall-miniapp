/**
 * 内置素材库（gaokao：仅文本，不含 PDF）
 *
 * 数据来源：core/library/gaokaoTexts.ts（require 模块，原 assets/gaokao/p1..p60.txt 已转入）
 * 完全离线可用；「导入到背诵」时创建 Article 并进入云同步。
 */

import { DB_DIR, readText, writeTextAtomic } from '../storage/fs';
import { createArticle, articleStore } from '../storage/entities';
import { emit, EVT } from '../store/bus';
import { scheduleSync } from '../net/sync';
import { GAOKAO_TEXTS } from './gaokaoTexts';

export interface LibraryItem {
  no: number;
  title: string;
}

export interface LibraryText {
  no: number;
  title: string;
  text: string;
}

const INDEX_CACHE = `${DB_DIR}/library/gaokao_index.json`;
const TOTAL = 60;

function pkgText(no: number): string {
  return GAOKAO_TEXTS[`p${no}`] || '';
}

function parseText(no: number, raw: string): LibraryText {
  const titleLine = raw.split('\n')[0] || '';
  const title = titleLine.startsWith('#') ? titleLine.replace(/^#\s*/, '').trim() : `第 ${no} 篇`;
  const body = titleLine.startsWith('#') ? raw.slice(titleLine.length + 1).replace(/^\n+/, '') : raw;
  return { no, title, text: body };
}

function buildIndex(): LibraryItem[] {
  const list: LibraryItem[] = [];
  for (let no = 1; no <= TOTAL; no++) {
    const raw = pkgText(no);
    if (!raw) continue;
    list.push({ no, title: parseText(no, raw).title });
  }
  return list;
}

function cachedIndex(): LibraryItem[] | null {
  const raw = readText(INDEX_CACHE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LibraryItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** 目录（本地构建 + 文件缓存） */
export async function loadIndex(_force = false): Promise<LibraryItem[]> {
  void _force;
  const cached = cachedIndex();
  if (cached) return cached;
  const list = buildIndex();
  if (list.length > 0) writeTextAtomic(INDEX_CACHE, JSON.stringify(list));
  return list;
}

/** 单篇正文（包内直读） */
export async function loadText(no: number, _force = false): Promise<LibraryText> {
  void _force;
  const raw = pkgText(no);
  if (!raw) throw new Error(`素材缺失（第 ${no} 篇）`);
  return parseText(no, raw);
}

/** 导入到背诵（同标题已存在则复用，避免重复） */
export function importToArticle(item: LibraryText): { articleUuid: string; created: boolean } {
  const existing = articleStore.list().find((a) => a.title === item.title && a.content === item.text);
  if (existing) return { articleUuid: existing.uuid, created: false };
  const article = createArticle({ title: item.title, content: item.text, autoIndent: true });
  emit(EVT.articlesChanged);
  scheduleSync();
  return { articleUuid: article.uuid, created: true };
}

/** 素材库免责声明（首次进入需确认） */
export const LIBRARY_DISCLAIMER = [
  '素材库内容（高考必背 60 篇）仅提供文本，用于个人背诵学习。',
  '请勿将内容用于任何商业用途或再分发；如涉版权问题，请联系我们处理。',
  '导入到「我的文章」后，数据将保存在本机并随账号云同步。',
].join('\n');
