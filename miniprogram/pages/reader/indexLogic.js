"use strict";
/**
 * 阅读模式辅助逻辑
 * - 分节：SectionSplitter 划分段落 → 聚合为 ~420 字/节
 * - 遮挡渲染：本地三粒度（ReaderOcclusion.localRangesInPara）/ 自定义遮罩（ReaderOcclusion.customMasks）
 * - 排版：字号/行距/字重/字体/背景（背景色取自主题模块，避免硬编码颜色）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fontFamilyOf = exports.readerDefaults = exports.saveReadingPos = exports.loadReadingPos = exports.buildContentStyle = exports.readingBackground = exports.buildRenderSections = exports.clampColorIndex = exports.FONT_WEIGHTS = exports.BG_OPTIONS = exports.LAYOUT_OPTIONS = exports.OCCLUSION_MODES = exports.FONT_PRESETS = void 0;
const section_1 = require("../../core/algorithms/section");
const occlusion_1 = require("../../core/algorithms/occlusion");
const prefs_1 = require("../../core/storage/prefs");
const theme_1 = require("../../core/theme/theme");
/** 每节目标字数 */
const TARGET_SECTION_CHARS = 420;
/** 阅读位置本地键前缀（per 文章，直接落 Storage） */
const POS_PREFIX = 'reading_pos_';
/** 预设字体（family 为空表示使用系统默认字体栈） */
exports.FONT_PRESETS = [
    { id: '0', name: '默认', family: '' },
    { id: 'serif', name: '宋体', family: "'Songti SC','SimSun',serif" },
    { id: 'hei', name: '黑体', family: "'PingFang SC','Heiti SC',sans-serif" },
    { id: 'mono', name: '等宽', family: "'Menlo','Consolas','Courier New',monospace" },
];
exports.OCCLUSION_MODES = [
    { value: 'short', label: '短（字词）' },
    { value: 'long', label: '长（整句）' },
    { value: 'mixed', label: '混合' },
];
exports.LAYOUT_OPTIONS = [
    { value: 0, label: '滚动' },
    { value: 1, label: '翻页' },
];
exports.BG_OPTIONS = [
    { value: 0, label: '跟随主题' },
    { value: 1, label: '米白' },
    { value: 2, label: '纯白' },
];
exports.FONT_WEIGHTS = [
    { value: 300, label: '细' },
    { value: 400, label: '常规' },
    { value: 500, label: '中' },
    { value: 700, label: '粗' },
];
/** 遮挡色索引 clamp 到 0..5 */
function clampColorIndex(n) {
    if (!Number.isFinite(n))
        return 0;
    if (n < 0)
        return 0;
    if (n > 5)
        return 5;
    return Math.round(n);
}
exports.clampColorIndex = clampColorIndex;
/** 将全文划分为 ~TARGET 字/节 的区间（基于 SectionSplitter 的段落） */
function sectionRanges(content) {
    const secs = section_1.SectionSplitter.split(content);
    if (secs.length === 0)
        return [{ start: 0, end: content.length }];
    const out = [];
    let cur = null;
    for (const s of secs) {
        if (cur === null)
            cur = { start: s.startChar, end: s.endChar };
        else
            cur.end = s.endChar;
        if (cur.end - cur.start >= TARGET_SECTION_CHARS) {
            out.push(cur);
            cur = null;
        }
    }
    if (cur)
        out.push(cur);
    return out.length > 0 ? out : [{ start: 0, end: content.length }];
}
function buildPara(text, gi, custom, opts) {
    let ranges = [];
    if (opts.enabled) {
        if (custom) {
            ranges = custom[gi] ? custom[gi].ranges : [];
        }
        else {
            ranges = occlusion_1.ReaderOcclusion.localRangesInPara(text, opts.mode).map((sp) => ({
                start: sp.start,
                end: sp.end,
                colorIndex: opts.colorIndex,
            }));
        }
    }
    const segs = occlusion_1.ReaderOcclusion.toRenderSegments(text, ranges).map((sg, i) => ({
        k: `p${gi}s${i}`,
        text: sg.text,
        occluded: sg.occluded,
        colorIndex: sg.occluded ? clampColorIndex(sg.colorIndex) : -1,
        revealed: false,
    }));
    return { k: `p${gi}`, segs };
}
/** 构建可渲染的「节」（WXML 不支持函数调用，派生结构需在此算好） */
function buildRenderSections(content, opts) {
    const ranges = sectionRanges(content);
    const paras = occlusion_1.ReaderOcclusion.splitParagraphs(content);
    const custom = opts.enabled && opts.customSpans ? occlusion_1.ReaderOcclusion.customMasks(content, opts.customSpans) : null;
    const sections = ranges.map((_r, i) => ({ index: i, paras: [] }));
    paras.forEach((p, gi) => {
        const para = buildPara(p.text, gi, custom, opts);
        let si = ranges.findIndex((r) => p.start >= r.start && p.start < r.end);
        if (si < 0)
            si = ranges.length - 1;
        sections[si].paras.push(para);
    });
    // 空节兜底（极端输入）
    sections.forEach((s) => {
        if (s.paras.length === 0)
            s.paras.push(buildPara('', s.index, null, opts));
    });
    return sections;
}
exports.buildRenderSections = buildRenderSections;
/**
 * 阅读区背景色：深色主题永远纯黑；浅色下按 bgMode 取米白/纯白/跟随主题。
 * 颜色值来自主题模块（不在此硬编码），保证与设计系统一致。
 */
function readingBackground(settings, bgMode) {
    const t = (0, theme_1.currentTheme)(settings);
    if (t.dark)
        return t.bg;
    if (bgMode === 1)
        return (0, theme_1.currentTheme)({ ...settings, themeMode: 'light', lightBackground: 'beige' }).bg;
    if (bgMode === 2)
        return (0, theme_1.currentTheme)({ ...settings, themeMode: 'light', lightBackground: 'white' }).bg;
    return t.bg;
}
exports.readingBackground = readingBackground;
/** 生成正文内联样式（字号/行距/字重/字体） */
function buildContentStyle(fontPx, lineHeight, fontWeight, fontFamily) {
    const parts = [`font-size:${fontPx}px`, `line-height:${lineHeight}`, `font-weight:${fontWeight}`];
    if (fontFamily)
        parts.push(`font-family:${fontFamily}`);
    return parts.join(';');
}
exports.buildContentStyle = buildContentStyle;
/** 读取阅读断点（整篇比例 0..1） */
function loadReadingPos(articleUuid) {
    try {
        const v = wx.getStorageSync(`${POS_PREFIX}${articleUuid}`);
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
    }
    catch {
        return 0;
    }
}
exports.loadReadingPos = loadReadingPos;
/** 保存阅读断点 */
function saveReadingPos(articleUuid, percent) {
    try {
        wx.setStorageSync(`${POS_PREFIX}${articleUuid}`, Math.max(0, Math.min(1, percent)));
    }
    catch {
        /* 忽略 */
    }
}
exports.saveReadingPos = saveReadingPos;
/** 当前设置（供页面读取默认排版） */
function readerDefaults() {
    const s = (0, prefs_1.getSettings)();
    return {
        fontPx: s.readingFontPx,
        lineHeight: s.readingLineHeight,
        fontId: s.readingFontId,
        fontWeight: s.readingFontWeight,
        bgMode: s.readingBgMode,
        layoutMode: s.readingLayoutMode,
    };
}
exports.readerDefaults = readerDefaults;
/** 字体 id → font-family（含云端字体族名） */
function fontFamilyOf(fontId, cloud) {
    const preset = exports.FONT_PRESETS.find((f) => f.id === fontId);
    if (preset)
        return preset.family;
    if (cloud.includes(fontId))
        return `'${fontId}','Songti SC',serif`;
    return '';
}
exports.fontFamilyOf = fontFamilyOf;
