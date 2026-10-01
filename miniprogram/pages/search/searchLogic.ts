/**
 * 搜索纯逻辑：关键词 / 日期（yyyy-MM-dd 或 yyyy/M/d）检索 + 命中高亮分段
 * 高亮用分段 view 渲染（不使用 innerHTML）。
 */

import { ArticleEntity } from '../../core/algorithms/types';
import { dateKey, formatShort } from '../../core/utils/date';

export interface Segment {
  text: string;
  hit: boolean;
}

export interface SearchResult {
  uuid: string;
  title: string;
  titleSegments: Segment[];
  excerptSegments: Segment[];
  timeText: string;
  matchLabel: string;
}

/** 关键词为日期时归一化为 yyyy-MM-dd（与 Android 端口径一致） */
export function parseDateQuery(query: string): string | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(query.trim());
  if (!m) return null;
  const month = String(Number(m[2])).padStart(2, '0');
  const day = String(Number(m[3])).padStart(2, '0');
  return `${m[1]}-${month}-${day}`;
}

/** 把文本按关键词切成分段（hit = 命中片段） */
export function splitSegments(text: string, keyword: string): Segment[] {
  if (!keyword) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const target = keyword.toLowerCase();
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(target, i);
    if (idx < 0) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) out.push({ text: text.slice(i, idx), hit: false });
    out.push({ text: text.slice(idx, idx + keyword.length), hit: true });
    i = idx + keyword.length;
  }
  return out;
}

/** 正文摘要：围绕首个命中位置取窗口，并高亮 */
function excerptSegments(content: string, keyword: string): Segment[] {
  const flat = content.replace(/\s+/g, ' ').trim();
  const idx = flat.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) {
    const head = flat.slice(0, 80);
    return [{ text: flat.length > 80 ? `${head}…` : head, hit: false }];
  }
  const start = Math.max(0, idx - 16);
  const end = Math.min(flat.length, idx + keyword.length + 56);
  const out: Segment[] = [];
  if (start > 0) out.push({ text: '…', hit: false });
  out.push(...splitSegments(flat.slice(start, end), keyword));
  if (end < flat.length) out.push({ text: '…', hit: false });
  return out;
}

/** 检索：标题 / 正文 / 日期；结果按更新时间倒序 */
export function searchArticles(articles: ArticleEntity[], rawKeyword: string): SearchResult[] {
  const keyword = rawKeyword.trim();
  if (!keyword) return [];
  const dateQuery = parseDateQuery(keyword);
  const lower = keyword.toLowerCase();
  const out: SearchResult[] = [];

  for (const a of articles.slice().sort((x, y) => y.updatedAt - x.updatedAt)) {
    const created = dateKey(a.createdAt);
    const updated = dateKey(a.updatedAt);

    if (dateQuery) {
      if (created !== dateQuery && updated !== dateQuery) continue;
      out.push({
        uuid: a.uuid,
        title: a.title,
        titleSegments: [{ text: a.title, hit: false }],
        excerptSegments: excerptSegments(a.content, ''),
        timeText: `创建 ${created} · 更新 ${updated}`,
        matchLabel: '日期匹配',
      });
      continue;
    }

    const inTitle = a.title.toLowerCase().indexOf(lower) >= 0;
    const inContent = a.content.toLowerCase().indexOf(lower) >= 0;
    if (!inTitle && !inContent) continue;
    out.push({
      uuid: a.uuid,
      title: a.title,
      titleSegments: splitSegments(a.title, keyword),
      excerptSegments: excerptSegments(a.content, keyword),
      timeText: `更新 ${formatShort(a.updatedAt)}`,
      matchLabel: inTitle ? '标题命中' : '正文命中',
    });
  }
  return out;
}