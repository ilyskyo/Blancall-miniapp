/**
 * 阅读模式辅助逻辑
 * - 分节：SectionSplitter 划分段落 → 聚合为 ~420 字/节
 * - 遮挡渲染：本地三粒度（ReaderOcclusion.localRangesInPara）/ 自定义遮罩（ReaderOcclusion.customMasks）
 * - 排版：字号/行距/字重/字体/背景（背景色取自主题模块，避免硬编码颜色）
 */

import { SectionSplitter } from '../../core/algorithms/section';
import { CustomSpanRange, MaskSpanData, ReaderOcclusion } from '../../core/algorithms/occlusion';
import { AppSettings, getSettings } from '../../core/storage/prefs';
import { currentTheme } from '../../core/theme/theme';

/** 每节目标字数 */
const TARGET_SECTION_CHARS = 420;

/** 阅读位置本地键前缀（per 文章，直接落 Storage） */
const POS_PREFIX = 'reading_pos_';

export interface RenderSeg {
  k: string;
  text: string;
  occluded: boolean;
  /** 遮挡色索引 0..5；普通片段为 -1 */
  colorIndex: number;
  revealed: boolean;
}

export interface RenderPara {
  k: string;
  segs: RenderSeg[];
}

export interface RenderSection {
  index: number;
  paras: RenderPara[];
}

export interface FontPreset {
  id: string;
  name: string;
  family: string;
}

/** 预设字体（family 为空表示使用系统默认字体栈） */
export const FONT_PRESETS: FontPreset[] = [
  { id: '0', name: '默认', family: '' },
  { id: 'serif', name: '宋体', family: "'Songti SC','SimSun',serif" },
  { id: 'hei', name: '黑体', family: "'PingFang SC','Heiti SC',sans-serif" },
  { id: 'mono', name: '等宽', family: "'Menlo','Consolas','Courier New',monospace" },
];

export const OCCLUSION_MODES: Array<{ value: string; label: string }> = [
  { value: 'short', label: '短（字词）' },
  { value: 'long', label: '长（整句）' },
  { value: 'mixed', label: '混合' },
];

export const LAYOUT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '滚动' },
  { value: 1, label: '翻页' },
];

export const BG_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '跟随主题' },
  { value: 1, label: '米白' },
  { value: 2, label: '纯白' },
];

export const FONT_WEIGHTS: Array<{ value: number; label: string }> = [
  { value: 300, label: '细' },
  { value: 400, label: '常规' },
  { value: 500, label: '中' },
  { value: 700, label: '粗' },
];

/** 遮挡色索引 clamp 到 0..5 */
export function clampColorIndex(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return Math.round(n);
}

/** 段落区间（相对全文的 [start,end)） */
interface RawRange {
  start: number;
  end: number;
}

/** 将全文划分为 ~TARGET 字/节 的区间（基于 SectionSplitter 的段落） */
function sectionRanges(content: string): RawRange[] {
  const secs = SectionSplitter.split(content);
  if (secs.length === 0) return [{ start: 0, end: content.length }];
  const out: RawRange[] = [];
  let cur: RawRange | null = null;
  for (const s of secs) {
    if (cur === null) cur = { start: s.startChar, end: s.endChar };
    else cur.end = s.endChar;
    if (cur.end - cur.start >= TARGET_SECTION_CHARS) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [{ start: 0, end: content.length }];
}

function buildPara(
  text: string,
  gi: number,
  custom: ReturnType<typeof ReaderOcclusion.customMasks> | null,
  opts: { enabled: boolean; mode: string; colorIndex: number }
): RenderPara {
  let ranges: CustomSpanRange[] = [];
  if (opts.enabled) {
    if (custom) {
      ranges = custom[gi] ? custom[gi].ranges : [];
    } else {
      ranges = ReaderOcclusion.localRangesInPara(text, opts.mode).map((sp) => ({
        start: sp.start,
        end: sp.end,
        colorIndex: opts.colorIndex,
      }));
    }
  }
  const segs: RenderSeg[] = ReaderOcclusion.toRenderSegments(text, ranges).map((sg, i) => ({
    k: `p${gi}s${i}`,
    text: sg.text,
    occluded: sg.occluded,
    colorIndex: sg.occluded ? clampColorIndex(sg.colorIndex) : -1,
    revealed: false,
  }));
  return { k: `p${gi}`, segs };
}

/** 构建可渲染的「节」（WXML 不支持函数调用，派生结构需在此算好） */
export function buildRenderSections(
  content: string,
  opts: { enabled: boolean; mode: string; colorIndex: number; customSpans: MaskSpanData[] | null }
): RenderSection[] {
  const ranges = sectionRanges(content);
  const paras = ReaderOcclusion.splitParagraphs(content);
  const custom = opts.enabled && opts.customSpans ? ReaderOcclusion.customMasks(content, opts.customSpans) : null;
  const sections: RenderSection[] = ranges.map((_r, i) => ({ index: i, paras: [] }));

  paras.forEach((p, gi) => {
    const para = buildPara(p.text, gi, custom, opts);
    let si = ranges.findIndex((r) => p.start >= r.start && p.start < r.end);
    if (si < 0) si = ranges.length - 1;
    sections[si].paras.push(para);
  });

  // 空节兜底（极端输入）
  sections.forEach((s) => {
    if (s.paras.length === 0) s.paras.push(buildPara('', s.index, null, opts));
  });
  return sections;
}

/**
 * 阅读区背景色：深色主题永远纯黑；浅色下按 bgMode 取米白/纯白/跟随主题。
 * 颜色值来自主题模块（不在此硬编码），保证与设计系统一致。
 */
export function readingBackground(settings: AppSettings, bgMode: number): string {
  const t = currentTheme(settings);
  if (t.dark) return t.bg;
  if (bgMode === 1) return currentTheme({ ...settings, themeMode: 'light', lightBackground: 'beige' }).bg;
  if (bgMode === 2) return currentTheme({ ...settings, themeMode: 'light', lightBackground: 'white' }).bg;
  return t.bg;
}

/** 生成正文内联样式（字号/行距/字重/字体） */
export function buildContentStyle(fontPx: number, lineHeight: number, fontWeight: number, fontFamily: string): string {
  const parts = [`font-size:${fontPx}px`, `line-height:${lineHeight}`, `font-weight:${fontWeight}`];
  if (fontFamily) parts.push(`font-family:${fontFamily}`);
  return parts.join(';');
}

/** 读取阅读断点（整篇比例 0..1） */
export function loadReadingPos(articleUuid: string): number {
  try {
    const v = wx.getStorageSync(`${POS_PREFIX}${articleUuid}`);
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
  } catch {
    return 0;
  }
}

/** 保存阅读断点 */
export function saveReadingPos(articleUuid: string, percent: number): void {
  try {
    wx.setStorageSync(`${POS_PREFIX}${articleUuid}`, Math.max(0, Math.min(1, percent)));
  } catch {
    /* 忽略 */
  }
}

/** 当前设置（供页面读取默认排版） */
export function readerDefaults(): { fontPx: number; lineHeight: number; fontId: string; fontWeight: number; bgMode: number; layoutMode: number } {
  const s = getSettings();
  return {
    fontPx: s.readingFontPx,
    lineHeight: s.readingLineHeight,
    fontId: s.readingFontId,
    fontWeight: s.readingFontWeight,
    bgMode: s.readingBgMode,
    layoutMode: s.readingLayoutMode,
  };
}

/** 字体 id → font-family（含云端字体族名） */
export function fontFamilyOf(fontId: string, cloud: string[]): string {
  const preset = FONT_PRESETS.find((f) => f.id === fontId);
  if (preset) return preset.family;
  if (cloud.includes(fontId)) return `'${fontId}','Songti SC',serif`;
  return '';
}