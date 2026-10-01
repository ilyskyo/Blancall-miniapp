"use strict";
/**
 * 自定义挖空编辑纯逻辑：句内字符视图、分句/编辑单元（句→词→字拆解）、撤销栈工具
 * 挖空坐标口径与练习引擎一致：s = SentenceSplitter.split 的句索引，a/b = 该句 trim 文本内的半开区间。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRANULARITY_LABEL = exports.toggleAllSentences = exports.isAllCovered = exports.blankAt = exports.nextGranularity = exports.detectGranularity = exports.blanksInClause = exports.unitsForClause = exports.clauseOf = exports.buildSentenceViews = exports.pushBounded = exports.snapshot = exports.UNDO_CAP = void 0;
const occlusion_1 = require("../../../../core/algorithms/occlusion");
/** 撤销/重做容量 */
exports.UNDO_CAP = 20;
/** 深拷贝挖空数组 */
function snapshot(blanks) {
    return blanks.map((b) => ({ s: b.s, a: b.a, b: b.b }));
}
exports.snapshot = snapshot;
/** 压栈（超容量丢最旧） */
function pushBounded(stack, item, cap = exports.UNDO_CAP) {
    stack.push(item);
    while (stack.length > cap)
        stack.shift();
}
exports.pushBounded = pushBounded;
/** 某句的挖空覆盖标记 */
function blankFlags(sentenceLen, blanks, si) {
    const flags = new Array(sentenceLen).fill(false);
    for (const b of blanks) {
        if (b.s !== si)
            continue;
        for (let i = b.a; i < b.b && i < sentenceLen; i++)
            if (i >= 0)
                flags[i] = true;
    }
    return flags;
}
/** 构建可渲染的句子字符视图（含挖空标记与待选起点高亮） */
function buildSentenceViews(sentences, blanks, pending) {
    return sentences.map((text, si) => {
        const flags = blankFlags(text.length, blanks, si);
        const chars = [];
        for (let ci = 0; ci < text.length; ci++) {
            let cls = flags[ci] ? 'char--blank' : '';
            if (pending && pending.s === si && pending.a === ci)
                cls = cls ? `${cls} char--sel` : 'char--sel';
            chars.push({ ci, ch: text[ci], cls });
        }
        return { si, chars };
    });
}
exports.buildSentenceViews = buildSentenceViews;
/** 句内分句区间（含句末标点），越界回退整句 */
function clauseOf(sentence, ci) {
    const ranges = occlusion_1.ReaderOcclusion.clauseRanges(sentence);
    const hit = ranges.find((r) => r.start <= ci && ci < r.end);
    if (hit)
        return hit;
    return { start: 0, end: sentence.length };
}
exports.clauseOf = clauseOf;
/** 某分句在指定粒度的编辑单元（0=整分句，1=词/字组，2=单字） */
function unitsForClause(sentence, clause, level) {
    if (level <= 0)
        return [{ start: clause.start, end: clause.end }];
    const units = occlusion_1.ReaderOcclusion.editUnits(sentence, level).filter((u) => u.start >= clause.start && u.end <= clause.end);
    return units.length > 0 ? units : [{ start: clause.start, end: clause.end }];
}
exports.unitsForClause = unitsForClause;
/** 判断已有挖空是否恰好等于给定单元集合 */
function matchesUnits(blanks, si, units) {
    if (blanks.length !== units.length)
        return false;
    const key = (a, b) => `${a}:${b}`;
    const set = new Set(blanks.map((b) => key(b.a, b.b)));
    return units.every((u) => set.has(key(u.start, u.end)));
}
/** 指定分句内的挖空（完全落在分句区间内） */
function blanksInClause(blanks, si, clause) {
    return blanks.filter((b) => b.s === si && b.a >= clause.start && b.b <= clause.end);
}
exports.blanksInClause = blanksInClause;
/** 推断某分句当前粒度（-1 = 无/自定义） */
function detectGranularity(blanks, si, sentence, clause) {
    const inClause = blanksInClause(blanks, si, clause);
    if (inClause.length === 0)
        return -1;
    for (let level = 0; level <= 2; level++) {
        if (matchesUnits(inClause, si, unitsForClause(sentence, clause, level)))
            return level;
    }
    return -1;
}
exports.detectGranularity = detectGranularity;
/** 下一次拆解粒度（句→词→字循环） */
function nextGranularity(blanks, si, sentence, clause) {
    const cur = detectGranularity(blanks, si, sentence, clause);
    return (cur + 1) % 3;
}
exports.nextGranularity = nextGranularity;
/** 找出包含该字符的挖空（用于点击删除） */
function blankAt(blanks, si, ci) {
    return blanks.find((b) => b.s === si && b.a <= ci && ci < b.b) || null;
}
exports.blankAt = blankAt;
/** 是否每句都已被整句挖空 */
function isAllCovered(sentences, blanks) {
    return sentences.every((text, si) => text.length === 0 || blanks.some((b) => b.s === si && b.a <= 0 && b.b >= text.length));
}
exports.isAllCovered = isAllCovered;
/** 「按句全选」：全部已整句挖空则清空整句空，否则补齐每句整句空 */
function toggleAllSentences(sentences, blanks) {
    if (isAllCovered(sentences, blanks)) {
        return blanks.filter((b) => !(b.a <= 0 && b.b >= (sentences[b.s] || '').length));
    }
    const out = snapshot(blanks);
    sentences.forEach((text, si) => {
        if (text.length === 0)
            return;
        const covered = out.some((b) => b.s === si && b.a <= 0 && b.b >= text.length);
        if (!covered)
            out.push({ s: si, a: 0, b: text.length });
    });
    return out;
}
exports.toggleAllSentences = toggleAllSentences;
exports.GRANULARITY_LABEL = ['整句', '词', '字'];
