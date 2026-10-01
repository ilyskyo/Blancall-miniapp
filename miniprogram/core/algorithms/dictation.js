"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DictationScorer = exports.score = void 0;
// 移植自 Android `com.ilyskyo.blancall.algorithm.DictationScorer`（Kotlin）
// 混合双通道评分：字符通道 0.7（整段 Damerau-Levenshtein 相似度）
//              + 分句通道 0.3（原文分句在用户分句中贪心最佳匹配后取平均，未默写计 0）。
// 依赖：TextNormalizer（./text）与 SentenceSplitter（./sentence），均与 Kotlin 侧同名同口径。
const text_1 = require("./text");
const sentence_1 = require("./sentence");
/** 整段输入截断上限（编辑距离为 O(n·m)，超长无标点文本会计算爆炸） */
const MAX_INPUT_LENGTH = 20000;
/** 单句截断上限 */
const MAX_CLAUSE_LENGTH = 5000;
/** 分句匹配的最低相似度阈值（低于视为该句未默写出来） */
const MATCH_THRESHOLD = 0.4;
/** 字符通道权重（分句通道为 1 - CHAR_WEIGHT） */
const CHAR_WEIGHT = 0.7;
// ── 辅助 ──
function isBlank(s) {
    return s.trim().length === 0;
}
function clamp01(v) {
    return Math.min(1, Math.max(0, v));
}
/**
 * 计算默写相似度（0..1）。空原文返回 0；双方都空返回 1。
 */
function score(correct, user) {
    if (isBlank(correct) && isBlank(user))
        return 1;
    if (isBlank(correct))
        return 0;
    if (isBlank(user))
        return 0;
    try {
        const safeCorrect = correct.length > MAX_INPUT_LENGTH ? correct.slice(0, MAX_INPUT_LENGTH) : correct;
        const safeUser = user.length > MAX_INPUT_LENGTH ? user.slice(0, MAX_INPUT_LENGTH) : user;
        const cNorm = text_1.TextNormalizer.normalize(safeCorrect);
        const uNorm = text_1.TextNormalizer.normalize(safeUser);
        if (cNorm.length === 0 && uNorm.length === 0)
            return 1;
        if (cNorm.length === 0 || uNorm.length === 0)
            return 0;
        // ── 字符通道：整段 DL 相似度 ──
        const maxLen = Math.max(cNorm.length, uNorm.length);
        const maxDist = Math.floor(maxLen / 2);
        const dist = damerauLevenshtein(uNorm, cNorm, maxDist);
        const charSim = dist > maxDist ? 0 : 1 - dist / maxLen;
        // ── 分句通道：原文分句，用户句贪心最佳匹配 ──
        const clauseSim = clauseSimilarity(safeCorrect, safeUser);
        return clamp01(CHAR_WEIGHT * charSim + (1 - CHAR_WEIGHT) * clauseSim);
    }
    catch {
        // 极端输入（OOM/异常）时兜底：按保守值处理，不影响练习主流程
        return 0;
    }
}
exports.score = score;
/**
 * 分句通道：原文每句在用户句中找相似度最高的未匹配句；
 * 用户没默写出的句子计 0，取平均（防止长文本稀释局部错误）。
 * 先归一化再分句：保证原文与用户文本切分粒度一致（标点/空白差异不会导致分句错位）。
 */
function clauseSimilarity(correct, user) {
    const cNormFull = text_1.TextNormalizer.normalize(correct);
    const uNormFull = text_1.TextNormalizer.normalize(user);
    const correctClauses = sentence_1.SentenceSplitter.split(cNormFull).filter((it) => it.trim().length > 0);
    if (correctClauses.length === 0)
        return 1;
    // 用户句按相同分句器切分（与原文粒度一致）
    const userClauses = sentence_1.SentenceSplitter.split(uNormFull).filter((it) => it.trim().length > 0);
    if (userClauses.length === 0)
        return 0;
    const userNorm = userClauses.map((it) => text_1.TextNormalizer.normalize(it.slice(0, MAX_CLAUSE_LENGTH)));
    const used = new Array(userNorm.length).fill(false);
    let total = 0;
    let count = 0;
    for (const clause of correctClauses) {
        const cNorm = clause.slice(0, MAX_CLAUSE_LENGTH);
        if (cNorm.length === 0)
            continue;
        count++;
        let bestSim = 0;
        let bestIdx = -1;
        const cLen = cNorm.length;
        for (let i = 0; i < userNorm.length; i++) {
            if (used[i])
                continue;
            const uLen = userNorm[i].length;
            if (uLen === 0)
                continue;
            // 长度预筛：相似度上界 = 1 - |lenA-lenB|/maxLen，低于当前最优或阈值则跳过 DL
            const maxLen = Math.max(cLen, uLen);
            const upperBound = 1 - Math.abs(cLen - uLen) / maxLen;
            if (upperBound < bestSim || upperBound < MATCH_THRESHOLD)
                continue;
            const sim = similarityWithBand(cNorm, userNorm[i]);
            if (sim > bestSim) {
                bestSim = sim;
                bestIdx = i;
                if (bestSim >= 0.95)
                    break;
            }
        }
        if (bestIdx >= 0 && bestSim >= MATCH_THRESHOLD) {
            used[bestIdx] = true;
            total += bestSim;
        }
        // 未匹配：total += 0（该句没默写出来）
    }
    return count === 0 ? 1 : total / count;
}
/** 带状 DL 相似度：dist 超过 maxDist 时直接返回 0 */
function similarityWithBand(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0)
        return 1;
    const maxDist = Math.floor(maxLen / 2);
    const dist = damerauLevenshtein(a, b, maxDist);
    return dist > maxDist ? 0 : 1 - dist / maxLen;
}
/**
 * Damerau-Levenshtein（OSA：最优字符串对齐）编辑距离。
 * 支持相邻换位（transposition）+ maxDist 带状提前终止（滚动数组，O(min(m,n)) 空间）。
 * 距离超过 maxDist 返回 maxDist+1。
 */
function damerauLevenshtein(a, b, maxDist) {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > maxDist)
        return maxDist + 1;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    // 带状 DL 用三行滚动：prev2（两行前，供换位）、prev、curr
    let prev2 = new Array(n + 1);
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) {
        prev2[j] = j;
        prev[j] = j;
    }
    let curr = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, // delete
            curr[j - 1] + 1, // insert
            prev[j - 1] + cost);
            // 相邻换位：a[i-1]==b[j-2] && a[i-2]==b[j-1]
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                curr[j] = Math.min(curr[j], prev2[j - 2] + 1);
            }
            if (curr[j] < rowMin)
                rowMin = curr[j];
        }
        // 带状截止：整行最小距离已超 maxDist，后续只增不减
        if (rowMin > maxDist)
            return maxDist + 1;
        const tmp = prev2;
        prev2 = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[n];
}
/** 聚合导出（对齐 Kotlin `object DictationScorer`） */
exports.DictationScorer = { score };
