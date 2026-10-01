"use strict";
// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// 阅读遮挡算法（本地三粒度遮挡 + 自定义遮罩转渲染片段）
// 对应 Kotlin：
//  - com.ilyskyo.blancall.ui.reader.ReaderOcclusion（本地遮挡 / 段落 / 分句 / 编辑单元）
//  - com.ilyskyo.blancall.ui.reader.ReadingContentViews（自定义 spans → 段内区间 → 渲染）
//  - com.ilyskyo.blancall.data.repository.MaskConfigStore.MaskSpan（自定义遮挡配置结构）
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReaderOcclusion = void 0;
const difficulty_1 = require("./difficulty");
/**
 * 分句标点集合（与 Kotlin `ReaderOcclusion.CLAUSE_PUNCT` 逐字符一致）。
 * 注意：源码字面量为 setOf('，', ',', '；', ';', '、', '。', '.', '！', '！', '?', '？', '\n')
 * —— 全角'！'(U+FF01) 重复了一次，半角'!'(U+0021) 实际缺席。此处忠实复刻（去重后集合等价）。
 */
const CLAUSE_PUNCT = new Set([
    '，', ',', '；', ';', '、', '。', '.', '！', '?', '？', '\n',
]);
/** 短遮挡（字词级）每分句选取的最难字数量上限与难度阈值 */
const SHORT_MAX_CHARS = 3;
const SHORT_THRESHOLD = 0.35;
/** 短遮挡（英文）：每分句选取的「长难词」上限；短于 LATIN_MIN_WORD_LEN 的词不值一遮 */
const SHORT_MAX_WORDS = 2;
const LATIN_MIN_WORD_LEN = 3;
/** 是否汉字（基本区 U+4E00-9FFF + 扩展 A 区 U+3400-4DBF），与 Kotlin `isChinese` 一致 */
function isChinese(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}
/** 是否字母（Unicode 属性 L，等价 Kotlin `Char.isLetter()`） */
function isLetter(ch) {
    return /\p{L}/u.test(ch);
}
/** 是否空白（等价 Kotlin `Char.isWhitespace()`） */
function isWhitespace(ch) {
    return /\s/u.test(ch);
}
/** [s, e) 内是否包含至少一个汉字 */
function hasChineseInRange(text, s, e) {
    for (let i = s; i < e; i++)
        if (isChinese(text[i]))
            return true;
    return false;
}
/**
 * [s, e) 内是否包含至少一个「值得遮挡」的拉丁单词（≥ LATIN_MIN_WORD_LEN 个字母）。
 * 修英文文章「算法遮挡不生效」：旧实现三种模式全依赖汉字判定，纯英文段落直接跳过。
 */
function hasLatinWordInRange(text, s, e) {
    let run = 0;
    for (let i = s; i < e; i++) {
        const c = text[i];
        if (isLetter(c) && !isChinese(c)) {
            run++;
            if (run >= LATIN_MIN_WORD_LEN)
                return true;
        }
        else {
            run = 0;
        }
    }
    return false;
}
/**
 * 短遮挡（英文）：在 [s, e) 内挑最长的至多 SHORT_MAX_WORDS 个拉丁单词，每词各成一个独立遮块。
 * 英文的「难」用词长度量（长词更难）；太短的词（a/is/to…）不遮。
 */
function pickHardWords(text, s, e) {
    const words = [];
    let i = s;
    while (i < e) {
        const c = text[i];
        if (isLetter(c) && !isChinese(c)) {
            let j = i;
            while (j < e && isLetter(text[j]) && !isChinese(text[j]))
                j++;
            if (j - i >= LATIN_MIN_WORD_LEN)
                words.push({ start: i, end: j });
            i = j;
        }
        else {
            i++;
        }
    }
    // 稳定降序（等长保持原顺序，与 Kotlin sortedByDescending 一致）
    return words
        .map((w, idx) => ({ w, idx }))
        .sort((x, y) => (y.w.end - y.w.start) - (x.w.end - x.w.start) || x.idx - y.idx)
        .slice(0, SHORT_MAX_WORDS)
        .map((it) => it.w);
}
/**
 * 短遮挡（字词级）：在 [s, e) 内挑最难的一至 SHORT_MAX_CHARS 个汉字，每字各成一个独立小遮块。
 */
function pickHardChars(text, s, e) {
    if (e - s < 2)
        return [];
    const hard = [];
    for (let i = s; i < e; i++) {
        if (isChinese(text[i])) {
            const d = difficulty_1.DifficultyCalculator.calculateCharDifficulty(text[i]);
            if (d >= SHORT_THRESHOLD)
                hard.push(i);
        }
    }
    if (hard.length === 0)
        return [];
    // 稳定降序（同难度保持原顺序）
    const sorted = hard
        .map((pos, idx) => ({ pos, d: difficulty_1.DifficultyCalculator.calculateCharDifficulty(text[pos]), idx }))
        .sort((x, y) => y.d - x.d || x.idx - y.idx)
        .slice(0, SHORT_MAX_CHARS)
        .map((it) => it.pos);
    return sorted.map((pos) => ({ start: pos, end: pos + 1 }));
}
/**
 * 混合遮挡的「本次分句是否用长遮挡」判定（等价 Kotlin `mixedUseLong`）。
 *
 * Kotlin 源码：
 *   var h = (clauseStart * 374761393L + textLen * 668265263L) and 0x7FFFFFFFFFFFFFFFL
 *   h = (h * 2654435761L) and 0x7FFFFFFFFFFFFFFFL
 *   return (h and 1L) == 0L
 *
 * 等价推导（确定性）：最终只取 bit0，而
 *  - 与 0x7FFF…F（bit0=1 的掩码）按位与不改变 bit0；
 *  - 64 位截断乘法中 bit0 只取决于两乘数的 bit0（低位不参与进位）；
 *  374761393 / 668265263 / 2654435761 皆奇数，故
 *  最终 bit0 == ((clauseStart + textLen) 的奇偶)。
 * 于是：clauseStart + textLen 为偶数 → 用长遮挡。与 Kotlin 结果逐位一致（Python 交叉验证）。
 */
function mixedUseLong(clauseStart, textLen) {
    return (clauseStart + textLen) % 2 === 0;
}
/** 将段落切成若干「分句 [s, e)」（e 含句末标点），三种模式复用 */
function clausesOf(para) {
    const res = [];
    let start = 0;
    for (let i = 0; i < para.length; i++) {
        if (CLAUSE_PUNCT.has(para[i])) {
            res.push([start, i + 1]); // 含句末标点：长遮时盖成干净整条，不露标点
            start = i + 1;
        }
    }
    if (start < para.length)
        res.push([start, para.length]);
    return res;
}
/**
 * 将文本按「空行段落」切分为段落，记录每个段落 trim 后在原文中的 [start,end)。
 * 与正文渲染的 split("\n\\s*\n") 语义对齐，供遮挡做区间映射。
 */
function splitParagraphs(text) {
    const res = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        // 跳过段落前空白/换行
        while (i < n && (isWhitespace(text[i]) || text[i] === '\n'))
            i++;
        if (i >= n)
            break;
        const s = i;
        while (i < n) {
            if (text[i] === '\n') {
                // 该换行是否构成「空行段落分隔」（其后若干空白后又换行）
                let j = i + 1;
                while (j < n && text[j] !== '\n' && isWhitespace(text[j]))
                    j++;
                if (j < n && text[j] === '\n')
                    break;
            }
            i++;
        }
        const e = i;
        let ls = s;
        while (ls < e && isWhitespace(text[ls]))
            ls++;
        let le = e;
        while (le > ls && isWhitespace(text[le - 1]))
            le--;
        if (le > ls)
            res.push({ start: ls, end: le, text: text.substring(ls, le) });
    }
    return res;
}
/** 段落级本地遮挡（返回段内区间） */
function localRangesInPara(para, mode) {
    const out = [];
    for (const [s, e] of clausesOf(para)) {
        if (e - s <= 0)
            continue;
        if (mode === 'long') {
            if (hasChineseInRange(para, s, e) || hasLatinWordInRange(para, s, e))
                out.push({ start: s, end: e });
        }
        else if (mode === 'short') {
            out.push(...pickHardChars(para, s, e), ...pickHardWords(para, s, e));
        }
        else if (mode === 'mixed') {
            if (mixedUseLong(s, para.length)) {
                if (hasChineseInRange(para, s, e) || hasLatinWordInRange(para, s, e))
                    out.push({ start: s, end: e });
            }
            else {
                out.push(...pickHardChars(para, s, e), ...pickHardWords(para, s, e));
            }
        }
        else {
            out.push(...pickHardChars(para, s, e), ...pickHardWords(para, s, e));
        }
    }
    // distinctBy { it.start }：按 start 去重，保留首次出现
    const seen = new Set();
    return out.filter((sp) => {
        if (seen.has(sp.start))
            return false;
        seen.add(sp.start);
        return true;
    });
}
/**
 * 段内「分句」区间（供遮挡自定义编辑器点句用）：
 * 与长遮挡/混合遮挡同一切分口径（按逗号/句号等分句标点，区间含句末标点）。
 */
function clauseRanges(para) {
    return clausesOf(para)
        .map(([s, e]) => ({ start: s, end: e }))
        .filter((sp) => sp.end > sp.start);
}
/**
 * 段内「编辑单元」区间（遮挡自定义编辑器拆词/拆字用）：
 * - level 1：字词——连续汉字每 2 字一块（末尾余 1 字自成一块），英文单词整体
 * - level >=2：单字——每个汉字一块，英文单词整体
 * 标点（非中文非字母字符）始终并入前一个单元，避免单独的标点块。
 */
function editUnits(para, level) {
    if (para.length === 0)
        return [];
    if (level <= 0)
        return [{ start: 0, end: para.length }];
    const out = [];
    let i = 0;
    const n = para.length;
    const isPunct = (c) => !isChinese(c) && !isLetter(c);
    const chunk = level === 1 ? 2 : 1;
    while (i < n) {
        const c = para[i];
        if (isChinese(c)) {
            let runEnd = i;
            while (runEnd < n && isChinese(para[runEnd]))
                runEnd++;
            let s = i;
            while (s < runEnd) {
                const e = Math.min(s + chunk, runEnd);
                out.push({ start: s, end: e });
                s = e;
            }
            i = runEnd;
        }
        else if (isLetter(c)) {
            let runEnd = i;
            while (runEnd < n && isLetter(para[runEnd]) && !isChinese(para[runEnd]))
                runEnd++;
            out.push({ start: i, end: runEnd });
            i = runEnd;
        }
        else {
            i++;
            while (i < n && isPunct(para[i]))
                i++;
            // 标点并入前一个单元（前移其终点）
            if (out.length > 0) {
                const last = out.pop();
                out.push({ start: last.start, end: i });
            }
            else if (i > 0) {
                out.push({ start: 0, end: i });
            }
        }
    }
    return out.filter((sp) => sp.end > sp.start);
}
/** 整篇本地遮挡（返回在 text 上的全局区间） */
function localRanges(text, mode) {
    const out = [];
    for (const p of splitParagraphs(text)) {
        for (const sp of localRangesInPara(p.text, mode)) {
            out.push({ start: p.start + sp.start, end: p.start + sp.end });
        }
    }
    return out;
}
/**
 * 自定义遮罩：把 MaskSpanData{p,a,e,c} 列表按段落转成可渲染的遮挡区间。
 * - 段落索引对齐 splitParagraphs 口径；
 * - 段内区间做有效性校验（0 <= a < e <= 段长），与正文段落索引/段内字符区间对齐；
 * - 同段内按 (a,e,c) 去重（对应 Android resolver 的 distinctBy(Triple(a,e,c))），保持原始顺序。
 */
function customMasks(content, spans) {
    const paras = splitParagraphs(content);
    const byP = new Map();
    for (const s of spans) {
        const arr = byP.get(s.p);
        if (arr)
            arr.push(s);
        else
            byP.set(s.p, [s]);
    }
    return paras.map((para, index) => {
        var _a;
        const list = (_a = byP.get(index)) !== null && _a !== void 0 ? _a : [];
        const seen = new Set();
        const ranges = [];
        for (const s of list) {
            if (!(s.a >= 0 && s.e > s.a && s.e <= para.text.length))
                continue;
            const key = s.a + ':' + s.e + ':' + s.c;
            if (seen.has(key))
                continue;
            seen.add(key);
            ranges.push({ start: s.a, end: s.e, colorIndex: s.c });
        }
        return { index, text: para.text, ranges };
    });
}
/**
 * 把一段正文按段内自定义遮挡区间切成「普通片段 / 遮挡片段」序列。
 * 重叠区间以「起点小者优先」语义处理：后到者的起点被钳制到当前游标，完全被覆盖者跳过。
 * 返回片段无缝覆盖整段（普通片段 colorIndex = -1）。
 */
function toRenderSegments(paraText, ranges) {
    const len = paraText.length;
    const valid = ranges
        .filter((r) => r.end > r.start && r.start >= 0 && r.end <= len)
        .map((r, idx) => ({ r, idx }))
        .sort((x, y) => (x.r.start - y.r.start) || (x.r.end - y.r.end) || (x.r.colorIndex - y.r.colorIndex) || x.idx - y.idx)
        .map((it) => it.r);
    const segs = [];
    let cursor = 0;
    for (const r of valid) {
        const s = Math.max(r.start, cursor);
        const e = r.end;
        if (e <= s)
            continue;
        if (s > cursor) {
            segs.push({ text: paraText.substring(cursor, s), start: cursor, end: s, occluded: false, colorIndex: -1 });
        }
        segs.push({ text: paraText.substring(s, e), start: s, end: e, occluded: true, colorIndex: r.colorIndex });
        cursor = e;
    }
    if (cursor < len) {
        segs.push({ text: paraText.substring(cursor), start: cursor, end: len, occluded: false, colorIndex: -1 });
    }
    return segs;
}
exports.ReaderOcclusion = {
    splitParagraphs,
    clauseRanges,
    editUnits,
    localRangesInPara,
    localRanges,
    customMasks,
    toRenderSegments,
};
