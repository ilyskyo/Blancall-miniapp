"use strict";
// 移植自 Android `com.ilyskyo.blancall.algorithm.AnswerChecker`（Kotlin）
// 忠实保留：阈值、预处理顺序、判定分支、贪心策略与诊断文案。
// Kotlin→TS：String 索引 = JS 字符串索引（UTF-16 code unit）；`Float` → `number`。
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnswerChecker = exports.checkDictation = exports.levenshtein = exports.toHalfWidth = exports.stripPunctAndSpace = exports.check = void 0;
// ── 中文标点 ──
const CHINESE_PUNCT = new Set([
    '，', '。', '！', '？', '；', '：', '、',
    '“', '”', '‘', '’', '（', '）', '【', '】', '《', '》',
    '…', '—', '～', '「', '」', '『', '』',
    '·', '﹐', '﹑',
]);
// ── 英文标点 ──
const ENGLISH_PUNCT = new Set([
    ',', '.', '!', '?', ';', ':', '(', ')', '[', ']', '<', '>',
    '"', '\'', '-', '_', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*',
    '+', '=', '`', '~',
]);
/** 是否空白（对齐 Kotlin Char.isWhitespace 常用口径） */
function isWhitespace(ch) {
    return /\s/.test(ch);
}
/** 是否数字（Kotlin Char.isDigit 的常用口径） */
function isDigit(ch) {
    return ch >= '0' && ch <= '9';
}
function check(correct, user) {
    const correctTrimmed = correct.trim();
    const userTrimmed = user.trim();
    // ── 空答案 ──
    if (userTrimmed.length === 0) {
        return {
            result: 'MISSING',
            correctAnswer: correctTrimmed,
            userAnswer: userTrimmed,
            message: '未作答',
            similarity: 0,
        };
    }
    // ── 完全一致 ──
    if (correctTrimmed === userTrimmed) {
        return {
            result: 'CORRECT',
            correctAnswer: correctTrimmed,
            userAnswer: userTrimmed,
            message: '正确',
            similarity: 1,
        };
    }
    // ── 标点/空白归一化后比对（含全半角 + 大小写归一化，英文容错，中文不受影响） ──
    const correctCore = toHalfWidth(stripPunctAndSpace(correctTrimmed)).toLowerCase();
    const userCore = toHalfWidth(stripPunctAndSpace(userTrimmed)).toLowerCase();
    if (correctCore.length === 0 && userCore.length === 0) {
        return {
            result: 'CORRECT',
            correctAnswer: correctTrimmed,
            userAnswer: userTrimmed,
            message: '正确',
            similarity: 1,
        };
    }
    if (correctCore === userCore) {
        // 核心内容完全一致，差异仅在于标点/空白/全半角/大小写
        const punctNote = describeSurfaceDiff(correctTrimmed, userTrimmed);
        return {
            result: 'CORRECT',
            correctAnswer: correctTrimmed,
            userAnswer: userTrimmed,
            message: `正确${punctNote}`,
            similarity: 1,
        };
    }
    // ── 基于核心文本做长度分析 ──
    const coreLen = correctCore.length;
    const userCoreLen = userCore.length;
    const editDist = levenshtein(correctCore, userCore);
    // 核心文本相似度（用于 UI 展示，与反向默写统一口径）
    const sim = similarity(correctCore, userCore);
    // ── 少字 ──
    if (userCoreLen < coreLen) {
        const ratio = editDist / coreLen;
        if (ratio <= 0.5 && editDist <= 2) {
            const diffInfo = diffChars(correctCore, userCore);
            return {
                result: 'MISSING',
                correctAnswer: correctTrimmed,
                userAnswer: userTrimmed,
                message: `少字${diffInfo}（缺 ${coreLen - userCoreLen} 个字）`,
                similarity: sim,
            };
        }
        else {
            const diffInfo = diffChars(correctCore, userCore);
            return {
                result: 'INCORRECT',
                correctAnswer: correctTrimmed,
                userAnswer: userTrimmed,
                message: `不正确${diffInfo}`,
                similarity: sim,
            };
        }
    }
    // ── 多字 ──
    if (userCoreLen > coreLen) {
        const ratio = editDist / userCoreLen;
        if (ratio <= 0.5 && editDist <= 2) {
            const diffInfo = diffChars(correctCore, userCore);
            return {
                result: 'EXTRA',
                correctAnswer: correctTrimmed,
                userAnswer: userTrimmed,
                message: `多字${diffInfo}（多了 ${userCoreLen - coreLen} 个字）`,
                similarity: sim,
            };
        }
        else {
            const diffInfo = diffChars(correctCore, userCore);
            return {
                result: 'INCORRECT',
                correctAnswer: correctTrimmed,
                userAnswer: userTrimmed,
                message: `不正确${diffInfo}`,
                similarity: sim,
            };
        }
    }
    // ── 长度相同 → 错别字 vs 顺序错误 vs 完全不同 ──
    const correctSorted = sortedChars(correctCore);
    const userSorted = sortedChars(userCore);
    if (correctSorted === userSorted) {
        return {
            result: 'WRONG_ORDER',
            correctAnswer: correctTrimmed,
            userAnswer: userTrimmed,
            message: '顺序错误（字都对，但顺序不对）',
            similarity: sim,
        };
    }
    // 编辑距离很小 → 错别字
    if (editDist <= 2 && editDist / coreLen <= 0.5) {
        const diffInfo = diffPositions(correctCore, userCore);
        return {
            result: 'TYPO',
            correctAnswer: correctTrimmed,
            userAnswer: userTrimmed,
            message: `错别字（${diffInfo} 不一样）`,
            similarity: sim,
        };
    }
    // 兜底：完全不对
    const diffInfo = diffChars(correctCore, userCore);
    return {
        result: 'INCORRECT',
        correctAnswer: correctTrimmed,
        userAnswer: userTrimmed,
        message: `不正确${diffInfo}`,
        similarity: sim,
    };
}
exports.check = check;
// ═══════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════
/** 排序后的字符串（等价 Kotlin `toCharArray().sorted()` 后按列表比较） */
function sortedChars(s) {
    return s.split('').sort().join('');
}
/** 去除中文+英文标点 + 所有空白（小数点在数字之间保留，避免数字答案误判） */
function stripPunctAndSpace(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (isWhitespace(c))
            continue;
        if (CHINESE_PUNCT.has(c) || ENGLISH_PUNCT.has(c)) {
            // 小数点在数字之间保留（如 3.14 / 1.0），其余标点去掉
            if (c === '.' && i > 0 && i < s.length - 1 && isDigit(s[i - 1]) && isDigit(s[i + 1])) {
                out += c;
            }
            continue;
        }
        out += c;
    }
    return out;
}
exports.stripPunctAndSpace = stripPunctAndSpace;
/** 全角 ASCII → 半角（按 UTF-16 code unit 遍历，与 Kotlin 一致） */
function toHalfWidth(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code >= 0xff01 && code <= 0xff5e) {
            out += String.fromCharCode(code - 0xfee0);
        }
        else if (code === 0x3000) {
            out += ' ';
        }
        else {
            out += s[i];
        }
    }
    return out;
}
exports.toHalfWidth = toHalfWidth;
/** 抽取标点/空白字符集（用于描述表面对差异） */
function punctsOf(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (isWhitespace(c) || CHINESE_PUNCT.has(c) || ENGLISH_PUNCT.has(c))
            out += c;
    }
    return out;
}
/** 描述标点/空白层面的差异（仅当核心内容一致时调用） */
function describeSurfaceDiff(correct, user) {
    const corPunct = punctsOf(correct);
    const usrPunct = punctsOf(user);
    if (corPunct.length === 0 && usrPunct.length > 0)
        return `（多了标点「${usrPunct}」）`;
    if (corPunct.length > 0 && usrPunct.length === 0)
        return `（漏了标点「${corPunct}」）`;
    return '（标点略有差异）';
}
/** Kotlin String.substringBefore / substringAfter 等价实现 */
function substringBefore(s, delimiter) {
    const idx = s.indexOf(delimiter);
    return idx < 0 ? s : s.slice(0, idx);
}
function substringAfter(s, delimiter) {
    const idx = s.indexOf(delimiter);
    return idx < 0 ? s : s.slice(idx + delimiter.length);
}
/** 简短描述两个字符串的差异 */
function diffChars(expected, actual) {
    if (expected.length === 0 && actual.length === 0)
        return '';
    if (actual.length === 0)
        return `（期望「${expected}」）`;
    if (expected.length === 0)
        return `（你写了「${actual}」）`;
    // 找最长公共子串
    const lcs = longestCommonSubstring(expected, actual);
    if (lcs.length >= 2) {
        const before = substringBefore(expected, lcs).slice(0, 4);
        const after = substringAfter(expected, lcs).slice(0, 4);
        const userBefore = substringBefore(actual, lcs).slice(0, 4);
        const userAfter = substringAfter(actual, lcs).slice(0, 4);
        const parts = [];
        if (userBefore.length > 0)
            parts.push(`多「${userBefore}」`);
        if (before.length > 0)
            parts.push(`缺「${before}」`);
        if (after !== userAfter)
            parts.push(`差异「${after}」→「${userAfter}」`);
        return parts.length === 0 ? '' : `（${parts.join('；')}）`;
    }
    // 完全无公共子串
    return `（期望「${expected.slice(0, 6)}」，你写的是「${actual.slice(0, 6)}」）`;
}
/** 最长公共子串（滚动数组，O(min(m,n)) 空间；时间仍 O(m*n)） */
function longestCommonSubstring(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0 || n === 0)
        return '';
    // 长串放外层、短串放内层，使滚动数组长度 = min(m,n)+1
    const longer = m >= n ? a : b;
    const shorter = m >= n ? b : a;
    const L = shorter.length;
    let maxLen = 0;
    let endIdxLonger = 0;
    let prev = new Array(L + 1).fill(0);
    let curr = new Array(L + 1).fill(0);
    for (let i = 1; i <= longer.length; i++) {
        for (let j = 1; j <= L; j++) {
            if (longer[i - 1] === shorter[j - 1]) {
                curr[j] = prev[j - 1] + 1;
                if (curr[j] > maxLen) {
                    maxLen = curr[j];
                    endIdxLonger = i;
                }
            }
            else {
                curr[j] = 0;
            }
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return longer.substring(endIdxLonger - maxLen, endIdxLonger);
}
/** 逐位比较，列出不同位置 */
function diffPositions(expected, actual) {
    const maxLen = Math.max(expected.length, actual.length);
    const diffs = [];
    for (let i = 0; i < maxLen; i++) {
        const e = i < expected.length ? expected[i] : null;
        const a = i < actual.length ? actual[i] : null;
        if (e !== a) {
            let desc = '';
            if (e !== null)
                desc += `「${e}」`;
            desc += '→';
            if (a !== null)
                desc += `「${a}」`;
            diffs.push(`第${i + 1}字${desc}`);
        }
    }
    return diffs.slice(0, 3).join('；');
}
/** Levenshtein 编辑距离（滚动数组，O(min(m,n)) 空间） */
function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++)
        prev[j] = j;
    let curr = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, // delete
            curr[j - 1] + 1, // insert
            prev[j - 1] + cost);
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[n];
}
exports.levenshtein = levenshtein;
// ═══════════════════════════════════════════
//  反向默写（段落打散默写）整段判分
// ═══════════════════════════════════════════
/**
 * 反向默写判分：用户默写整段，与原文分句逐句最佳匹配
 * @param originalClauses 原文分句列表（正确顺序，逗号/句号粒度）
 * @param userInput 用户默写的整段文本
 */
function checkDictation(originalClauses, userInput) {
    // 防御：超长输入截断（编辑距离为 O(m*n)，超长无标点文本会让计算爆炸导致卡死/OOM）
    const safeInput = userInput.length > 20000 ? userInput.slice(0, 20000) : userInput;
    // 用户输入按分句粒度切分（逗号/句号等），与原文分句对齐匹配
    const userClauses = splitUserInputIntoClauses(safeInput);
    if (originalClauses.length === 0) {
        return {
            sentences: [],
            coverageRate: 0,
            accuracyRate: 0,
            orderCorrectRate: 0,
            overallScore: 0,
        };
    }
    // 原文分句归一化缓存
    const originalNorm = originalClauses.map((it) => toHalfWidth(stripPunctAndSpace(it)).toLowerCase());
    const used = new Array(originalClauses.length).fill(false);
    const sentenceResults = [];
    for (let uIdx = 0; uIdx < userClauses.length; uIdx++) {
        const userSent = userClauses[uIdx];
        // 防御：单分句超长截断（编辑距离为 O(m*n)，保护极端输入）
        const userSentSafe = userSent.length > 5000 ? userSent.slice(0, 5000) : userSent;
        const userNorm = toHalfWidth(stripPunctAndSpace(userSentSafe)).toLowerCase();
        if (userNorm.length === 0) {
            sentenceResults.push({
                userText: userSent,
                matchedOriginal: null,
                matchIndex: -1,
                similarity: 0,
                result: 'MISSING',
            });
            continue;
        }
        // 在未匹配的原文分句中找相似度最高的
        let bestIdx = -1;
        let bestSim = 0;
        const userLen = userNorm.length;
        for (let oIdx = 0; oIdx < originalClauses.length; oIdx++) {
            if (used[oIdx])
                continue;
            const oNorm = originalNorm[oIdx];
            if (oNorm.length === 0)
                continue;
            // 长度预筛：编辑距离 >= |lenA - lenB|，故相似度上界 = 1 - |lenA-lenB|/maxLen。
            // 若该上界低于当前 bestSim 或匹配阈值 0.5，similarity 必然不达标，跳过 levenshtein 计算。
            const oLen = oNorm.length;
            const maxLen = Math.max(userLen, oLen);
            const lenDiff = Math.abs(userLen - oLen);
            const simUpperBound = 1 - lenDiff / maxLen;
            if (simUpperBound < bestSim || simUpperBound < 0.5)
                continue;
            const sim = similarity(oNorm, userNorm);
            if (sim > bestSim) {
                bestSim = sim;
                bestIdx = oIdx;
                // 提前终止：已达 CORRECT 阈值，不可能更高
                if (bestSim >= 0.95)
                    break;
            }
        }
        if (bestIdx >= 0 && bestSim >= 0.5) {
            used[bestIdx] = true;
            const res = bestSim >= 0.95 ? 'CORRECT' : bestSim >= 0.7 ? 'TYPO' : 'INCORRECT';
            sentenceResults.push({
                userText: userSent,
                matchedOriginal: originalClauses[bestIdx],
                matchIndex: bestIdx,
                similarity: bestSim,
                result: res,
            });
        }
        else {
            sentenceResults.push({
                userText: userSent,
                matchedOriginal: null,
                matchIndex: -1,
                similarity: bestSim,
                result: 'INCORRECT',
            });
        }
    }
    const matchedCount = sentenceResults.filter((it) => it.matchIndex >= 0).length;
    const coverageRate = matchedCount / originalClauses.length;
    const accuracyRate = sentenceResults.length === 0
        ? 0
        : sentenceResults.reduce((acc, it) => acc + it.similarity, 0) / sentenceResults.length;
    // 顺序正确率：用户分句中，匹配到的且 matchIndex 递增的比例
    let orderCorrect = 0;
    let lastMatchedIdx = -1;
    for (const r of sentenceResults) {
        if (r.matchIndex >= 0) {
            if (r.matchIndex > lastMatchedIdx)
                orderCorrect++;
            lastMatchedIdx = r.matchIndex;
        }
    }
    const orderCorrectRate = userClauses.length === 0 ? 0 : orderCorrect / userClauses.length;
    const overallScore = Math.min(1, Math.max(0, coverageRate * 0.4 + accuracyRate * 0.4 + orderCorrectRate * 0.2));
    return {
        sentences: sentenceResults,
        coverageRate,
        accuracyRate,
        orderCorrectRate,
        overallScore,
    };
}
exports.checkDictation = checkDictation;
/** 把用户默写的整段文本按分句粒度切分（逗号/句号等标点保留在前一个分句末尾） */
function splitUserInputIntoClauses(text) {
    const punct = new Set([
        '，', ',', ';', '；', '、', '。', '.', '！', '!', '？', '?', '…', '\n',
    ]);
    const result = [];
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        current += ch;
        if (punct.has(ch)) {
            const s = current.trim();
            if (s.length > 0)
                result.push(s);
            current = '';
        }
    }
    if (current.length > 0) {
        const s = current.trim();
        if (s.length > 0)
            result.push(s);
    }
    return result;
}
/** 相似度：1 - 归一化编辑距离 */
function similarity(a, b) {
    if (a.length === 0 && b.length === 0)
        return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0)
        return 1;
    const dist = levenshtein(a, b);
    return 1 - dist / maxLen;
}
/** 聚合导出（对齐 Kotlin `object AnswerChecker`） */
exports.AnswerChecker = { check, checkDictation };
