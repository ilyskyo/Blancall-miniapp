"use strict";
/**
 * 遮罩编辑纯逻辑：段落视图、段内字符视图、预览片段（customMasks/toRenderSegments）、句→词→字拆解
 * 段落索引 p 与 ReaderOcclusion.splitParagraphs 口径一致，保证 customMasks 渲染正确。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushBounded = exports.snapshotSpans = exports.GRANULARITY_LABEL = exports.nextLevel = exports.detectLevel = exports.spansInClause = exports.unitsForClause = exports.clauseOf = exports.buildPreview = exports.buildCharViews = exports.rangesOfParagraph = exports.buildParaRows = exports.colorOf = exports.UNDO_CAP = exports.MASK_COLORS = void 0;
const occlusion_1 = require("../../../../core/algorithms/occlusion");
const theme_1 = require("../../../../core/theme/theme");
/** 遮挡块颜色（索引 0–5，取自主题色板前 6 色） */
exports.MASK_COLORS = theme_1.ACCENT_PRESETS.slice(0, 6).map((p) => p.color);
exports.UNDO_CAP = 20;
function colorOf(index) {
    return exports.MASK_COLORS[index % exports.MASK_COLORS.length] || exports.MASK_COLORS[0];
}
exports.colorOf = colorOf;
function buildParaRows(paras, spans, selected) {
    return paras.map((p, index) => ({
        index,
        no: index + 1,
        preview: p.text.replace(/\n+/g, ' ').slice(0, 40),
        cls: index === selected ? 'para-row para-row--on' : 'para-row',
        spanCount: spans.filter((s) => s.p === index).length,
    }));
}
exports.buildParaRows = buildParaRows;
function rangesOfParagraph(spans, p) {
    return spans
        .filter((s) => s.p === p)
        .map((s) => ({ start: s.a, end: s.e, colorIndex: s.c }));
}
exports.rangesOfParagraph = rangesOfParagraph;
/** 构建段内逐字符视图（遮挡上色 + 待选起点高亮） */
function buildCharViews(text, ranges, pending) {
    const out = [];
    for (let ci = 0; ci < text.length; ci++) {
        const range = ranges.find((r) => r.start <= ci && ci < r.end);
        let cls = '';
        let style = '';
        if (range) {
            cls = 'char char--mask';
            style = `background:${colorOf(range.colorIndex)};color:transparent`;
        }
        else {
            cls = 'char';
        }
        if (pending !== null && pending === ci)
            cls += ' char--sel';
        out.push({ ci, ch: text[ci], cls, style });
    }
    return out;
}
exports.buildCharViews = buildCharViews;
function buildPreview(text, ranges, revealed) {
    const segs = occlusion_1.ReaderOcclusion.toRenderSegments(text, ranges);
    return segs.map((seg) => {
        if (!seg.occluded)
            return { key: seg.start, text: seg.text, cls: 'seg', style: '', revealed: false };
        const isRevealed = revealed.has(seg.start);
        if (isRevealed)
            return { key: seg.start, text: seg.text, cls: 'seg seg--revealed', style: '', revealed: true };
        return {
            key: seg.start,
            text: seg.text,
            cls: 'seg mask-block',
            style: `background:${colorOf(seg.colorIndex)};color:transparent`,
            revealed: false,
        };
    });
}
exports.buildPreview = buildPreview;
// ---------------- 句→词→字拆解 ----------------
function clauseOf(text, ci) {
    const ranges = occlusion_1.ReaderOcclusion.clauseRanges(text);
    const hit = ranges.find((r) => r.start <= ci && ci < r.end);
    return hit || { start: 0, end: text.length };
}
exports.clauseOf = clauseOf;
function unitsForClause(text, clause, level) {
    if (level <= 0)
        return [{ start: clause.start, end: clause.end }];
    const units = occlusion_1.ReaderOcclusion.editUnits(text, level).filter((u) => u.start >= clause.start && u.end <= clause.end);
    return units.length > 0 ? units : [{ start: clause.start, end: clause.end }];
}
exports.unitsForClause = unitsForClause;
function spansInClause(spans, p, clause) {
    return spans.filter((s) => s.p === p && s.a >= clause.start && s.e <= clause.end);
}
exports.spansInClause = spansInClause;
function matchesUnits(inClause, units) {
    if (inClause.length !== units.length)
        return false;
    const set = new Set(inClause.map((s) => `${s.a}:${s.e}`));
    return units.every((u) => set.has(`${u.start}:${u.end}`));
}
function detectLevel(spans, p, text, clause) {
    const inClause = spansInClause(spans, p, clause);
    if (inClause.length === 0)
        return -1;
    for (let level = 0; level <= 2; level++) {
        if (matchesUnits(inClause, unitsForClause(text, clause, level)))
            return level;
    }
    return -1;
}
exports.detectLevel = detectLevel;
function nextLevel(spans, p, text, clause) {
    return (detectLevel(spans, p, text, clause) + 1) % 3;
}
exports.nextLevel = nextLevel;
exports.GRANULARITY_LABEL = ['整句', '词', '字'];
/** 深拷贝挖空 */
function snapshotSpans(spans) {
    return spans.map((s) => ({ p: s.p, a: s.a, e: s.e, c: s.c }));
}
exports.snapshotSpans = snapshotSpans;
function pushBounded(stack, item, cap = exports.UNDO_CAP) {
    stack.push(item);
    while (stack.length > cap)
        stack.shift();
}
exports.pushBounded = pushBounded;
