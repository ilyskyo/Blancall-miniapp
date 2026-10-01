/**
 * 遮罩编辑纯逻辑：段落视图、段内字符视图、预览片段（customMasks/toRenderSegments）、句→词→字拆解
 * 段落索引 p 与 ReaderOcclusion.splitParagraphs 口径一致，保证 customMasks 渲染正确。
 */

import { MaskSpanData } from '../../../../core/storage/entities';
import { CustomSpanRange, OcclusionSpan, ReaderOcclusion } from '../../../../core/algorithms/occlusion';
import { ACCENT_PRESETS } from '../../../../core/theme/theme';

/** 遮挡块颜色（索引 0–5，取自主题色板前 6 色） */
export const MASK_COLORS: string[] = ACCENT_PRESETS.slice(0, 6).map((p) => p.color);

export const UNDO_CAP = 20;

export function colorOf(index: number): string {
  return MASK_COLORS[index % MASK_COLORS.length] || MASK_COLORS[0];
}

// ---------------- 段落列表 ----------------

export interface ParaRow {
  index: number;
  no: number;
  preview: string;
  cls: string;
  spanCount: number;
}

export function buildParaRows(paras: Array<{ text: string }>, spans: MaskSpanData[], selected: number): ParaRow[] {
  return paras.map((p, index) => ({
    index,
    no: index + 1,
    preview: p.text.replace(/\n+/g, ' ').slice(0, 40),
    cls: index === selected ? 'para-row para-row--on' : 'para-row',
    spanCount: spans.filter((s) => s.p === index).length,
  }));
}

// ---------------- 段内字符视图 ----------------

export interface CharView {
  ci: number;
  ch: string;
  cls: string;
  style: string;
}

export function rangesOfParagraph(spans: MaskSpanData[], p: number): CustomSpanRange[] {
  return spans
    .filter((s) => s.p === p)
    .map((s) => ({ start: s.a, end: s.e, colorIndex: s.c }));
}

/** 构建段内逐字符视图（遮挡上色 + 待选起点高亮） */
export function buildCharViews(text: string, ranges: CustomSpanRange[], pending: number | null): CharView[] {
  const out: CharView[] = [];
  for (let ci = 0; ci < text.length; ci++) {
    const range = ranges.find((r) => r.start <= ci && ci < r.end);
    let cls = '';
    let style = '';
    if (range) {
      cls = 'char char--mask';
      style = `background:${colorOf(range.colorIndex)};color:transparent`;
    } else {
      cls = 'char';
    }
    if (pending !== null && pending === ci) cls += ' char--sel';
    out.push({ ci, ch: text[ci], cls, style });
  }
  return out;
}

// ---------------- 预览 ----------------

export interface SegView {
  key: number;
  text: string;
  cls: string;
  style: string;
  revealed: boolean;
}

export function buildPreview(text: string, ranges: CustomSpanRange[], revealed: Set<number>): SegView[] {
  const segs = ReaderOcclusion.toRenderSegments(text, ranges);
  return segs.map((seg) => {
    if (!seg.occluded) return { key: seg.start, text: seg.text, cls: 'seg', style: '', revealed: false };
    const isRevealed = revealed.has(seg.start);
    if (isRevealed) return { key: seg.start, text: seg.text, cls: 'seg seg--revealed', style: '', revealed: true };
    return {
      key: seg.start,
      text: seg.text,
      cls: 'seg mask-block',
      style: `background:${colorOf(seg.colorIndex)};color:transparent`,
      revealed: false,
    };
  });
}

// ---------------- 句→词→字拆解 ----------------

export function clauseOf(text: string, ci: number): OcclusionSpan {
  const ranges = ReaderOcclusion.clauseRanges(text);
  const hit = ranges.find((r) => r.start <= ci && ci < r.end);
  return hit || { start: 0, end: text.length };
}

export function unitsForClause(text: string, clause: OcclusionSpan, level: number): OcclusionSpan[] {
  if (level <= 0) return [{ start: clause.start, end: clause.end }];
  const units = ReaderOcclusion.editUnits(text, level).filter((u) => u.start >= clause.start && u.end <= clause.end);
  return units.length > 0 ? units : [{ start: clause.start, end: clause.end }];
}

export function spansInClause(spans: MaskSpanData[], p: number, clause: OcclusionSpan): MaskSpanData[] {
  return spans.filter((s) => s.p === p && s.a >= clause.start && s.e <= clause.end);
}

function matchesUnits(inClause: MaskSpanData[], units: OcclusionSpan[]): boolean {
  if (inClause.length !== units.length) return false;
  const set = new Set(inClause.map((s) => `${s.a}:${s.e}`));
  return units.every((u) => set.has(`${u.start}:${u.end}`));
}

export function detectLevel(spans: MaskSpanData[], p: number, text: string, clause: OcclusionSpan): number {
  const inClause = spansInClause(spans, p, clause);
  if (inClause.length === 0) return -1;
  for (let level = 0; level <= 2; level++) {
    if (matchesUnits(inClause, unitsForClause(text, clause, level))) return level;
  }
  return -1;
}

export function nextLevel(spans: MaskSpanData[], p: number, text: string, clause: OcclusionSpan): number {
  return (detectLevel(spans, p, text, clause) + 1) % 3;
}

export const GRANULARITY_LABEL = ['整句', '词', '字'];

/** 深拷贝挖空 */
export function snapshotSpans(spans: MaskSpanData[]): MaskSpanData[] {
  return spans.map((s) => ({ p: s.p, a: s.a, e: s.e, c: s.c }));
}

export function pushBounded<T>(stack: T[], item: T, cap = UNDO_CAP): void {
  stack.push(item);
  while (stack.length > cap) stack.shift();
}