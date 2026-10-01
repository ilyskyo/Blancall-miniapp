"use strict";
/**
 * 挖空生成器：支持句子挖空和字词挖空两种模式
 * 对应 Kotlin `com.ilyskyo.blancall.algorithm.BlancallGenerator`
 *
 * - 句子挖空：可挖分句、半句、复句（按逗号/分号粒度切分，相邻选中分句自动合并）
 * - 字词挖空：挖 1-3 字词或英文单词，相邻选中词自动合并为一个空
 * - 支持动态自适应策略（均衡/薄弱点优先/全覆盖）
 * - 支持反向默写（段落打散后默写原文）
 * - 支持古文模式（优先挖实词，虚词可选不挖）
 * - 支持中英文混排
 *
 * Kotlin→TS 约定：
 * - String 索引 = JS 字符串索引（UTF-16 code unit）；Char → 单字符 string
 * - Kotlin-IntRange 用 `IntRange { first, last }`（闭区间）表示
 * - toInt() → Math.trunc（向零截断）；roundToInt() → Math.round
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlancallGenerator = exports.Strategy = void 0;
const sentence_1 = require("./sentence");
const difficulty_1 = require("./difficulty");
const types_1 = require("./types");
// ========== 共享常量（编译一次） ==========
/** 逗号/分号切分正则（短文本兜底用） */
const CLAUSE_SPLIT_REGEX = /[，,;；]/;
/** 分句切分标点 */
const CLAUSE_PUNCT = new Set(['，', ',', ';', '；', '、']);
/** 英文单词匹配（无汉字时兜底挖空） */
const ENGLISH_WORD_REGEX = /[A-Za-z]+/;
/** 挖空策略（对应 Kotlin enum Strategy） */
exports.Strategy = {
    BALANCED: 'BALANCED',
    WEAKNESS_FOCUS: 'WEAKNESS_FOCUS',
    FULL_COVERAGE: 'FULL_COVERAGE',
};
// ========== 内部工具 ==========
function isChinese(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}
function isLetter(ch) {
    return /\p{L}/u.test(ch);
}
function coerceIn(v, min, max) {
    return v < min ? min : v > max ? max : v;
}
function replaceRange(str, start, end, replacement) {
    return str.slice(0, start) + replacement + str.slice(end);
}
/** 对比器：句索引升序、句内位置升序（对应 compareBy({sentenceIdx},{charStart})） */
function bySentenceThenPos(a, b) {
    return a.sentenceIdx - b.sentenceIdx || a.charStart - b.charStart;
}
function getOrPut(map, key, make) {
    let v = map.get(key);
    if (v === undefined) {
        v = make();
        map.set(key, v);
    }
    return v;
}
/** Kotlin List.shuffled() 等价（Fisher-Yates，原地打乱索引） */
function shuffledIndices(n) {
    const arr = [];
    for (let i = 0; i < n; i++)
        arr.push(i);
    for (let i = arr.length - 1; i >= 1; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}
// ========== 句子挖空：支持分句/半句/复句 ==========
/** 按逗号/分号/顿号拆分分句，标点保留在前一个分句末尾 */
function splitByClausePunctuation(text) {
    const result = [];
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        current += ch;
        if (CLAUSE_PUNCT.has(ch)) {
            result.push(current);
            current = '';
        }
    }
    if (current.length > 0)
        result.push(current);
    return result.length > 0 ? result : [text];
}
function generateSentenceCloze(content, count = 0, errorProfile = (0, types_1.emptyErrorProfile)(), strategy = 'BALANCED') {
    let allSentences = sentence_1.SentenceSplitter.split(content);
    // 短文本兜底：按逗号/分号再次切分
    if (allSentences.length <= 1 && content.length > 5) {
        allSentences = content
            .split(CLAUSE_SPLIT_REGEX)
            .map((it) => it.trim())
            .filter((it) => it.length > 0 && containsChinese(it));
        if (allSentences.length === 0) {
            allSentences = [content.trim()];
        }
    }
    if (allSentences.length === 0) {
        return { sentences: [], blanks: [], displayText: content };
    }
    // 将每句按逗号/分号/顿号拆分为分句（累加指针记录位置，避免重复短语定位错误）
    const allClauses = [];
    for (let sIdx = 0; sIdx < allSentences.length; sIdx++) {
        const sentence = allSentences[sIdx];
        const parts = splitByClausePunctuation(sentence);
        let pos = 0;
        for (const part of parts) {
            if (part.trim().length > 0) {
                allClauses.push({ text: part, sentenceIdx: sIdx, startInSentence: pos, endInSentence: pos + part.length });
            }
            pos += part.length;
        }
    }
    // 确定挖几个空（自动档：记忆偏弱时适度加量）
    const totalClauses = allClauses.length;
    let baseCount;
    if (count > 0)
        baseCount = coerceIn(count, 1, totalClauses);
    else if (totalClauses === 1)
        baseCount = 1;
    else if (totalClauses <= 4)
        baseCount = Math.max(1, Math.trunc(totalClauses / 2));
    else
        baseCount = Math.max(1, Math.trunc(totalClauses / 3));
    const densityScale = count > 0 ? 1 : coerceIn(errorProfile.memoryFactor, 1, 1.6);
    const actualCount = coerceIn(Math.trunc(baseCount * densityScale), 1, totalClauses);
    // 策略驱动选择要挖的分句
    let selectedClauseIndices;
    if (strategy === exports.Strategy.WEAKNESS_FOCUS) {
        // 句级错误率尚无数据链路时改为随机选取，保持策略语义中性
        const hasSentenceData = allClauses.some((it) => { var _a; return ((_a = errorProfile.sentenceErrorRates[it.sentenceIdx]) !== null && _a !== void 0 ? _a : 0) > 0; });
        if (!hasSentenceData) {
            selectedClauseIndices = new Set(shuffledIndices(allClauses.length).slice(0, actualCount));
        }
        else {
            const weighted = allClauses.map((c, idx) => {
                var _a;
                const errorRate = (_a = errorProfile.sentenceErrorRates[c.sentenceIdx]) !== null && _a !== void 0 ? _a : 0;
                return { idx, w: errorRate + 0.1 };
            });
            weighted.sort((a, b) => b.w - a.w);
            selectedClauseIndices = new Set(weighted.slice(0, actualCount).map((it) => it.idx));
        }
    }
    else if (strategy === exports.Strategy.FULL_COVERAGE) {
        // 均匀分布，每个分句都有机会（用去重后补足）
        const step = Math.max(1, Math.trunc(allClauses.length / actualCount));
        const indices = [];
        const seen = new Set();
        let pos = 0;
        while (seen.size < actualCount && pos < allClauses.length) {
            const v = Math.min(pos, allClauses.length - 1);
            if (!seen.has(v)) {
                seen.add(v);
                indices.push(v);
            }
            pos += step;
        }
        // 如果因步长问题不足，从尾部补充
        let fill = allClauses.length - 1;
        while (seen.size < actualCount && fill >= 0) {
            if (!seen.has(fill)) {
                seen.add(fill);
                indices.push(fill);
            }
            fill--;
        }
        selectedClauseIndices = new Set(indices.slice(0, actualCount));
    }
    else {
        // 均衡：随机但有微弱薄弱倾斜；记忆偏弱时倾斜更强
        const mf = coerceIn(errorProfile.memoryFactor, 1, 1.6);
        const tempWeights = allClauses.map((c, idx) => {
            var _a;
            const errorRate = (_a = errorProfile.sentenceErrorRates[c.sentenceIdx]) !== null && _a !== void 0 ? _a : 0;
            return { idx, w: 0.5 + errorRate * 0.5 * mf };
        });
        const selected = new Set();
        for (let n = 0; n < actualCount; n++) {
            if (tempWeights.length === 0)
                break;
            const currentTotal = tempWeights.reduce((s, it) => s + it.w, 0);
            let r = Math.random() * currentTotal;
            let chosen = tempWeights[tempWeights.length - 1].idx;
            for (const it of tempWeights) {
                r -= it.w;
                if (r <= 0) {
                    chosen = it.idx;
                    break;
                }
            }
            selected.add(chosen);
            for (let k = tempWeights.length - 1; k >= 0; k--) {
                if (tempWeights[k].idx === chosen)
                    tempWeights.splice(k, 1);
            }
        }
        selectedClauseIndices = selected;
    }
    // 合并同一句内相邻的选中分句（复句）
    const blankGroups = [];
    let i = 0;
    while (i < allClauses.length) {
        if (selectedClauseIndices.has(i)) {
            const group = [allClauses[i]];
            i++;
            while (i < allClauses.length &&
                selectedClauseIndices.has(i) &&
                allClauses[i].sentenceIdx === group[group.length - 1].sentenceIdx) {
                group.push(allClauses[i]);
                i++;
            }
            blankGroups.push(group);
        }
        else {
            i++;
        }
    }
    // 构建 SentenceBlankInfo 列表
    const blanks = blankGroups.map((group, idx) => {
        const first = group[0];
        const last = group[group.length - 1];
        return {
            index: idx,
            originalText: group.map((it) => it.text).join(''),
            sentenceIndex: first.sentenceIdx,
            startInSentence: first.startInSentence,
            endInSentence: last.endInSentence,
        };
    });
    // 构建 displayText（句内用 [N] ___ 标记，句内从后往前替换）
    const displayParts = [];
    for (let sIdx = 0; sIdx < allSentences.length; sIdx++) {
        const sentenceBlanks = blanks.filter((b) => b.sentenceIndex === sIdx).sort((a, b) => a.startInSentence - b.startInSentence);
        if (sentenceBlanks.length === 0) {
            displayParts.push(allSentences[sIdx]);
        }
        else {
            let s = allSentences[sIdx];
            for (let k = sentenceBlanks.length - 1; k >= 0; k--) {
                const b = sentenceBlanks[k];
                s = replaceRange(s, b.startInSentence, b.endInSentence, `[${b.index + 1}] ___`);
            }
            displayParts.push(s);
        }
    }
    return { sentences: allSentences, blanks, displayText: displayParts.join('\n') };
}
/** 判断字符串是否含任意汉字 */
function containsChinese(s) {
    for (let i = 0; i < s.length; i++) {
        if (isChinese(s[i]))
            return true;
    }
    return false;
}
/** 统计句子中的英文单词数（用于字词挖空的最大空数计算） */
function countEnglishWords(s) {
    let count = 0;
    let i = 0;
    while (i < s.length) {
        if (isLetter(s[i]) && !isChinese(s[i])) {
            count++;
            while (i < s.length && isLetter(s[i]))
                i++;
        }
        else {
            i++;
        }
    }
    return count;
}
function generateWordCloze(content, count = 0, errorProfile = (0, types_1.emptyErrorProfile)(), strategy = 'BALANCED', classicalMode = false) {
    var _a, _b, _c;
    const allSentences = sentence_1.SentenceSplitter.split(content);
    // 词候选（连续汉字 1-3 字，或英文单词整体）
    const candidates = [];
    for (let sIdx = 0; sIdx < allSentences.length; sIdx++) {
        const sentence = allSentences[sIdx];
        let i = 0;
        while (i < sentence.length) {
            if (isChinese(sentence[i])) {
                const runStart = i;
                while (i < sentence.length && isChinese(sentence[i]))
                    i++;
                const runEnd = i;
                for (let start = runStart; start < runEnd; start++) {
                    for (let len = 1; len <= Math.min(3, runEnd - start); len++) {
                        const word = sentence.substring(start, start + len);
                        let sum = 0;
                        for (let c = 0; c < word.length; c++)
                            sum += difficulty_1.DifficultyCalculator.calculateCharDifficulty(word[c]);
                        const avgDiff = sum / word.length;
                        // 错误历史加权（字级别 + 词级别）；记忆偏弱时错误历史权重更大
                        const mf = coerceIn(errorProfile.memoryFactor, 1, 1.6);
                        let charErrorBonus = 0;
                        for (let c = 0; c < word.length; c++) {
                            const e = (_a = errorProfile.charErrorRates[word[c]]) !== null && _a !== void 0 ? _a : 0;
                            if (e > charErrorBonus)
                                charErrorBonus = e;
                        }
                        const wordErrorBonus = (_b = errorProfile.wordErrorRates[word]) !== null && _b !== void 0 ? _b : 0;
                        const mistakeBonus = (charErrorBonus * 0.3 + wordErrorBonus * 0.4) * mf;
                        // 古文模式：虚词降权
                        const functionWordPenalty = classicalMode && isFunctionWord(word) ? -0.3 : 0;
                        const difficulty = coerceIn(avgDiff + mistakeBonus + functionWordPenalty, 0, 1);
                        candidates.push({ text: word, sentenceIdx: sIdx, charStart: start, charEnd: start + len, difficulty });
                    }
                }
            }
            else if (isLetter(sentence[i])) {
                // 英文单词候选（整个单词作为一个空，错误率用小写 key 匹配）
                const runStart = i;
                while (i < sentence.length && isLetter(sentence[i]))
                    i++;
                const word = sentence.substring(runStart, i);
                const wordErrorBonus = ((_c = errorProfile.wordErrorRates[word.toLowerCase()]) !== null && _c !== void 0 ? _c : 0) * coerceIn(errorProfile.memoryFactor, 1, 1.6);
                const difficulty = coerceIn(0.5 + wordErrorBonus, 0, 1);
                candidates.push({ text: word, sentenceIdx: sIdx, charStart: runStart, charEnd: i, difficulty });
            }
            else {
                i++;
            }
        }
    }
    if (candidates.length === 0) {
        return {
            sentences: allSentences.map((it) => ({ text: it, blanks: [] })),
            blanks: [],
            displayText: content,
            maxBlanks: 0,
            suggestedBlanks: 0,
        };
    }
    // 最大可挖空数 = 全部中文字符数 + 英文单词数
    const maxBlanks = allSentences.reduce((acc, s) => acc + countChinese(s) + countEnglishWords(s), 0);
    // 建议挖空数（保守建议，不等于最大值）
    let suggestedBlanks;
    if (maxBlanks <= 3)
        suggestedBlanks = Math.max(1, maxBlanks);
    else if (maxBlanks <= 10)
        suggestedBlanks = Math.max(2, Math.trunc(maxBlanks / 2));
    else if (maxBlanks <= 30)
        suggestedBlanks = Math.max(3, Math.trunc(maxBlanks / 3));
    else if (maxBlanks <= 80)
        suggestedBlanks = Math.max(4, Math.trunc(maxBlanks / 5));
    else
        suggestedBlanks = Math.max(5, Math.trunc(maxBlanks / 8));
    suggestedBlanks = coerceIn(suggestedBlanks, 1, maxBlanks);
    // 贪心选取不重叠的词
    const sorted = candidates.slice().sort((a, b) => b.difficulty - a.difficulty);
    const occupiedBySentence = new Map();
    const selected = [];
    for (const c of sorted) {
        const occupied = getOrPut(occupiedBySentence, c.sentenceIdx, () => []);
        const range = [c.charStart, c.charEnd - 1];
        if (!occupied.some((it) => it[0] <= range[1] && range[0] <= it[1])) {
            selected.push(c);
            occupied.push(range);
        }
    }
    let finalSelection;
    if (count > 0) {
        const targetCount = coerceIn(count, 1, maxBlanks);
        if (targetCount <= selected.length) {
            // 多字候选够用 → 取前 targetCount 个，不合并
            finalSelection = selected
                .slice()
                .sort((a, b) => b.difficulty - a.difficulty)
                .slice(0, targetCount)
                .sort(bySentenceThenPos);
        }
        else {
            // 多字候选不够 → 混合多字 + 单字补充
            const usedPositions = new Set();
            for (const it of selected) {
                for (let p = it.charStart; p < it.charEnd; p++)
                    usedPositions.add(`${it.sentenceIdx},${p}`);
            }
            const singleChars = candidates
                .filter((it) => it.text.length === 1 && !usedPositions.has(`${it.sentenceIdx},${it.charStart}`))
                .sort((a, b) => b.difficulty - a.difficulty);
            const combined = selected.concat(singleChars.slice(0, targetCount - selected.length));
            if (combined.length >= targetCount) {
                finalSelection = combined.slice().sort(bySentenceThenPos);
            }
            else {
                // 多字候选占位过多 → 全部改用单字重选
                const singleOnly = candidates.filter((it) => it.text.length === 1).sort((a, b) => b.difficulty - a.difficulty);
                const redoOccupied = new Map();
                const redoSelected = [];
                for (const c of singleOnly) {
                    if (redoSelected.length >= targetCount)
                        break;
                    const occ = getOrPut(redoOccupied, c.sentenceIdx, () => []);
                    const r = [c.charStart, c.charEnd - 1];
                    if (!occ.some((it2) => it2[0] <= r[1] && r[0] <= it2[1])) {
                        redoSelected.push(c);
                        occ.push(r);
                    }
                }
                finalSelection = redoSelected.slice().sort(bySentenceThenPos);
            }
        }
    }
    else {
        // 自动模式
        let actualCount;
        if (maxBlanks <= 5)
            actualCount = selected.length;
        else if (maxBlanks <= 20)
            actualCount = Math.max(1, Math.trunc(selected.length / 3));
        else
            actualCount = Math.max(1, Math.trunc(selected.length / 4));
        const sortedSelected = selected.slice(0, actualCount).slice().sort(bySentenceThenPos);
        // 合并相邻的空
        const merged = [];
        let mi = 0;
        while (mi < sortedSelected.length) {
            let m = sortedSelected[mi];
            let mj = mi + 1;
            while (mj < sortedSelected.length &&
                sortedSelected[mj].sentenceIdx === m.sentenceIdx &&
                sortedSelected[mj].charStart === m.charEnd) {
                const nx = sortedSelected[mj];
                m = {
                    text: m.text + nx.text,
                    sentenceIdx: m.sentenceIdx,
                    charStart: m.charStart,
                    charEnd: nx.charEnd,
                    difficulty: Math.max(m.difficulty, nx.difficulty),
                };
                mj++;
            }
            merged.push(m);
            mi = mj;
        }
        finalSelection = merged;
    }
    // 构建显示文本
    const resultBlanks = [];
    const resultSentences = [];
    const sentenceBuilders = allSentences.slice();
    // 从后往前替换（避免偏移错位）
    for (const m of finalSelection
        .slice()
        .sort((a, b) => b.sentenceIdx - a.sentenceIdx || b.charStart - a.charStart)) {
        sentenceBuilders[m.sentenceIdx] = replaceRange(sentenceBuilders[m.sentenceIdx], m.charStart, m.charEnd, '___');
    }
    let globalIdx = 0;
    for (let sIdx = 0; sIdx < allSentences.length; sIdx++) {
        const displayText = sentenceBuilders[sIdx];
        const blankIndicesInSentence = [];
        for (const m of finalSelection) {
            if (m.sentenceIdx === sIdx) {
                resultBlanks.push({ index: globalIdx, originalChar: m.text, position: m.charStart });
                blankIndicesInSentence.push(globalIdx);
                globalIdx++;
            }
        }
        resultSentences.push({ text: displayText, blanks: blankIndicesInSentence });
    }
    const displayText = resultSentences.map((it) => it.text).join('\n');
    return { sentences: resultSentences, blanks: resultBlanks, displayText, maxBlanks, suggestedBlanks };
}
/** 统计句子中的汉字数 */
function countChinese(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++)
        if (isChinese(s[i]))
            n++;
    return n;
}
// ═══════════════════════════════════════════
//  古文虚词（F10）
// ═══════════════════════════════════════════
/** 常见文言文 / 白话文虚词（代词、介词、连词、助词、叹词） */
const FUNCTION_WORDS = new Set([
    // 单字虚词
    '之', '乎', '者', '也', '矣', '焉', '哉', '耳', '耶', '欤', '邪',
    '而', '以', '于', '其', '为', '所', '与', '则', '且', '乃', '虽',
    '然', '若', '何', '孰', '安', '胡', '曷', '盍', '奚', '恶', '岂',
    '惟', '盖', '夫', '故', '是', '或', '既', '及', '因', '自', '从',
    '诸', '焉', '斯', '兹', '彼', '此', '莫', '勿', '毋', '未', '非',
    '亦', '又', '尚', '犹', '但', '只', '仅', '方', '几', '庶',
    '曾', '尝', '请', '敢', '窃', '辱', '幸', '伏', '忝',
    // 白话文虚词
    '的', '了', '在', '是', '有', '和', '就', '都', '也', '把', '被',
    '让', '给', '向', '对', '从', '到', '用', '以', '为', '因', '所',
    '与', '及', '或', '但', '而', '且', '虽', '然', '如', '若', '则',
]);
/** 判断是否为虚词（单字直接查表；多字词检查首尾字是否虚词） */
function isFunctionWord(word) {
    if (word.length === 1)
        return FUNCTION_WORDS.has(word);
    if (word.length === 0)
        return false;
    return FUNCTION_WORDS.has(word[0]) || FUNCTION_WORDS.has(word[word.length - 1]);
}
// ═══════════════════════════════════════════
//  反向默写（段落打散 + 挖空 + 打乱顺序）
// ═══════════════════════════════════════════
/** 反向默写切分标点：逗号/分号/顿号/句号/问号/叹号（标点保留在前一个分句末尾） */
const DICTATION_CLAUSE_PUNCT = new Set(['，', ',', ';', '；', '、', '。', '.', '！', '!', '？', '?', '…']);
/** 按反向默写分句标点切分（标点保留在前一个分句末尾） */
function splitByDictationPunctuation(text) {
    const result = [];
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        current += ch;
        if (DICTATION_CLAUSE_PUNCT.has(ch)) {
            result.push(current);
            current = '';
        }
    }
    if (current.length > 0)
        result.push(current);
    return result.length > 0 ? result : [text];
}
/**
 * 反向默写：把段落按分句粒度（逗号/句号等）切分，每个分句挖 1 个空，
 * 然后打乱顺序作为线索，让用户还原顺序并默写原文。
 */
function generateDictation(content) {
    if (content.trim().length === 0)
        return { clauses: [], shuffledClauses: [] };
    // 先按句末标点切句（处理英文缩写/小数），再按逗号等切分句
    const sentences = sentence_1.SentenceSplitter.split(content);
    const clauses = [];
    for (const s of sentences) {
        const parts = splitByDictationPunctuation(s);
        for (const p of parts)
            if (p.trim().length > 0)
                clauses.push(p);
    }
    if (clauses.length === 0)
        return { clauses: [], shuffledClauses: [] };
    const blankedClauses = clauses.map((it) => blankOneWordInClause(it));
    const order = shuffledIndices(clauses.length);
    const shuffled = order.map((origIdx, displayOrder) => ({
        displayOrder,
        originalIndex: origIdx,
        originalText: clauses[origIdx],
        displayText: blankedClauses[origIdx],
    }));
    return { clauses, shuffledClauses: shuffled };
}
// ═══════════════════════════════════════════
//  自定义挖空构造（编辑器选点 → 确定性结果）
// ═══════════════════════════════════════════
/** 合并相邻/重叠区间，返回按起点升序的不相交闭区间 */
function mergeRanges(ranges) {
    const acc = [];
    for (const r of ranges.slice().sort((a, b) => a.first - b.first)) {
        const last = acc.length > 0 ? acc[acc.length - 1] : null;
        if (last !== null && r.first <= last.last + 1) {
            acc[acc.length - 1] = { first: last.first, last: Math.max(last.last, r.last) };
        }
        else {
            acc.push(r);
        }
    }
    return acc;
}
/**
 * 把「句内字符区间」规范化到给定句长（自定义挖空保存/应用的统一口径）。
 * - 越界裁剪：a 取 coerceIn(0, len-1)、b 取 coerceIn(a+1, len)
 * - 非法区间（b<=a）丢弃；相邻/重叠合并；sentenceLength<=0 返回空
 */
function normalizeClampedRanges(sentenceLength, ranges) {
    if (sentenceLength <= 0 || ranges.length === 0)
        return [];
    const mapped = [];
    for (const r of ranges) {
        const a = coerceIn(r.first, 0, sentenceLength - 1);
        const b = coerceIn(r.last + 1, a + 1, sentenceLength);
        if (b > a)
            mapped.push({ first: a, last: b - 1 });
    }
    return mergeRanges(mapped);
}
/**
 * 自定义句子挖空：按「句索引 → 句内区间列表」构造句子挖空结果。
 * 区间自动合并相邻/重叠、过滤越界；displayText 用同款 "[N] ___" 标记。
 */
function buildCustomSentenceCloze(content, rangesBySentence) {
    const sentences = sentence_1.SentenceSplitter.split(content);
    // 规范化：越界过滤 + 相邻/重叠合并
    const normalized = new Map();
    for (const [sentenceIndex, ranges] of rangesBySentence) {
        const len = sentenceIndex >= 0 && sentenceIndex < sentences.length ? sentences[sentenceIndex].length : 0;
        const norm = normalizeClampedRanges(len, ranges);
        if (norm.length > 0)
            normalized.set(sentenceIndex, norm);
    }
    const all = [];
    const keys = Array.from(normalized.keys()).sort((a, b) => a - b);
    for (const s of keys) {
        for (const range of normalized.get(s)) {
            all.push({ sIdx: s, range, text: sentences[s].substring(range.first, range.last + 1) });
        }
    }
    const blanks = all.map((sel, idx) => ({
        index: idx,
        originalText: sel.text,
        sentenceIndex: sel.sIdx,
        startInSentence: sel.range.first,
        endInSentence: sel.range.last + 1,
    }));
    const builders = sentences.slice();
    for (const b of blanks
        .slice()
        .sort((a, b2) => b2.sentenceIndex - a.sentenceIndex || b2.startInSentence - a.startInSentence)) {
        builders[b.sentenceIndex] = replaceRange(builders[b.sentenceIndex], b.startInSentence, b.endInSentence, `[${b.index + 1}] ___`);
    }
    return { sentences, blanks, displayText: builders.join('\n') };
}
/**
 * 自定义反向默写：仅对选中句子做分句切分 + 每分句挖一词 + 打乱，
 * 未选中句子不参与。
 */
function buildCustomDictation(content, selectedSentences) {
    if (selectedSentences.size === 0)
        return { clauses: [], shuffledClauses: [] };
    const sentences = sentence_1.SentenceSplitter.split(content);
    const clauses = [];
    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
        if (!selectedSentences.has(sIdx))
            continue;
        for (const part of splitByDictationPunctuation(sentences[sIdx])) {
            if (part.trim().length > 0)
                clauses.push(part);
        }
    }
    if (clauses.length === 0)
        return { clauses: [], shuffledClauses: [] };
    const blankedClauses = clauses.map((it) => blankOneWordInClause(it));
    const order = shuffledIndices(clauses.length);
    const shuffled = order.map((origIdx, displayOrder) => ({
        displayOrder,
        originalIndex: origIdx,
        originalText: clauses[origIdx],
        displayText: blankedClauses[origIdx],
    }));
    return { clauses, shuffledClauses: shuffled };
}
/**
 * 在分句中挖 1 个空：优先挖难度最高的中文字符；无汉字时挖英文单词；
 * 都没有则原样返回。挖掉的内容替换为 ___。
 */
function blankOneWordInClause(clause) {
    if (clause.trim().length === 0)
        return clause;
    // 找难度最高的中文字符
    let bestIdx = -1;
    let bestDiff = -1;
    for (let i = 0; i < clause.length; i++) {
        if (isChinese(clause[i])) {
            const d = difficulty_1.DifficultyCalculator.calculateCharDifficulty(clause[i]);
            if (d > bestDiff) {
                bestDiff = d;
                bestIdx = i;
            }
        }
    }
    if (bestIdx >= 0) {
        // 扩展挖 1-2 字：若相邻也是高难度汉字，合并挖掉
        let end = bestIdx + 1;
        if (end < clause.length &&
            isChinese(clause[end]) &&
            difficulty_1.DifficultyCalculator.calculateCharDifficulty(clause[end]) >= bestDiff * 0.8) {
            end++;
        }
        return clause.substring(0, bestIdx) + '___' + clause.substring(end);
    }
    // 无汉字：挖第一个英文单词
    const wordMatch = ENGLISH_WORD_REGEX.exec(clause);
    if (wordMatch !== null) {
        return replaceRange(clause, wordMatch.index, wordMatch.index + wordMatch[0].length, '___');
    }
    // 都没有：原样返回
    return clause;
}
// ── 挖空结果 JSON 序列化：key 名与 Kotlin org.json 输出逐字一致 ──
function asObject(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        throw new Error('not an object');
    return v;
}
function reqArray(o, key) {
    const v = o[key];
    if (!Array.isArray(v))
        throw new Error('missing array: ' + key);
    return v;
}
function reqString(o, key) {
    const v = o[key];
    if (typeof v !== 'string')
        throw new Error('missing string: ' + key);
    return v;
}
function reqInt(o, key) {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error('missing int: ' + key);
    return Math.trunc(v);
}
function sentenceClozeToJson(r) {
    return JSON.stringify({
        sentences: r.sentences,
        blanks: r.blanks.map((b) => ({
            index: b.index,
            originalText: b.originalText,
            sentenceIndex: b.sentenceIndex,
            startInSentence: b.startInSentence,
            endInSentence: b.endInSentence,
        })),
        displayText: r.displayText,
    });
}
function sentenceClozeFromJson(json) {
    try {
        const o = asObject(JSON.parse(json));
        const sArr = reqArray(o, 'sentences');
        const sentences = sArr.map((v) => {
            if (typeof v !== 'string')
                throw new Error('sentence not string');
            return v;
        });
        const bArr = reqArray(o, 'blanks');
        const blanks = bArr.map((raw) => {
            const b = asObject(raw);
            return {
                index: reqInt(b, 'index'),
                originalText: reqString(b, 'originalText'),
                sentenceIndex: reqInt(b, 'sentenceIndex'),
                startInSentence: reqInt(b, 'startInSentence'),
                endInSentence: reqInt(b, 'endInSentence'),
            };
        });
        return { sentences, blanks, displayText: reqString(o, 'displayText') };
    }
    catch {
        return null;
    }
}
function wordClozeToJson(r) {
    return JSON.stringify({
        sentences: r.sentences.map((s) => ({ text: s.text, blanks: s.blanks })),
        blanks: r.blanks.map((b) => ({ index: b.index, originalChar: b.originalChar, position: b.position })),
        displayText: r.displayText,
        maxBlanks: r.maxBlanks,
        suggestedBlanks: r.suggestedBlanks,
    });
}
function wordClozeFromJson(json) {
    try {
        const o = asObject(JSON.parse(json));
        const sArr = reqArray(o, 'sentences');
        const sentences = sArr.map((raw) => {
            const s = asObject(raw);
            const bl = reqArray(s, 'blanks');
            return {
                text: reqString(s, 'text'),
                blanks: bl.map((v) => {
                    if (typeof v !== 'number' || !Number.isFinite(v))
                        throw new Error('blank not int');
                    return Math.trunc(v);
                }),
            };
        });
        const bArr = reqArray(o, 'blanks');
        const blanks = bArr.map((raw) => {
            const b = asObject(raw);
            return { index: reqInt(b, 'index'), originalChar: reqString(b, 'originalChar'), position: reqInt(b, 'position') };
        });
        return {
            sentences,
            blanks,
            displayText: reqString(o, 'displayText'),
            maxBlanks: reqInt(o, 'maxBlanks'),
            suggestedBlanks: reqInt(o, 'suggestedBlanks'),
        };
    }
    catch {
        return null;
    }
}
function dictationToJson(r) {
    return JSON.stringify({
        clauses: r.clauses,
        shuffledClauses: r.shuffledClauses.map((s) => ({
            displayOrder: s.displayOrder,
            originalIndex: s.originalIndex,
            originalText: s.originalText,
            displayText: s.displayText,
        })),
    });
}
function dictationFromJson(json) {
    try {
        const o = asObject(JSON.parse(json));
        const cArr = reqArray(o, 'clauses');
        const clauses = cArr.map((v) => {
            if (typeof v !== 'string')
                throw new Error('clause not string');
            return v;
        });
        const shArr = reqArray(o, 'shuffledClauses');
        const shuffled = shArr.map((raw) => {
            const s = asObject(raw);
            return {
                displayOrder: reqInt(s, 'displayOrder'),
                originalIndex: reqInt(s, 'originalIndex'),
                originalText: reqString(s, 'originalText'),
                displayText: reqString(s, 'displayText'),
            };
        });
        return { clauses, shuffledClauses: shuffled };
    }
    catch {
        return null;
    }
}
exports.BlancallGenerator = {
    Strategy: exports.Strategy,
    generateSentenceCloze,
    generateWordCloze,
    generateDictation,
    buildCustomSentenceCloze,
    buildCustomDictation,
    isFunctionWord,
    sentenceClozeToJson,
    sentenceClozeFromJson,
    wordClozeToJson,
    wordClozeFromJson,
    dictationToJson,
    dictationFromJson,
};
