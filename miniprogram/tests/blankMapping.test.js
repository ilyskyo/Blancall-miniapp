"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sentence_1 = require("../core/algorithms/sentence");
const cloze_1 = require("../core/algorithms/cloze");
const blankMapping_1 = require("../core/practice/blankMapping");
/** 固定测试文本（3 句，含中英文与标点） */
const CONTENT = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
const MULTI = '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。';
/** 在固定随机源下生成字词挖空（保证测试可复现） */
function generateWordClozeDeterministic(content, count = 4) {
    const original = Math.random;
    Math.random = () => 0.5;
    try {
        return cloze_1.BlancallGenerator.generateWordCloze(content, count);
    }
    finally {
        Math.random = original;
    }
}
// ============================== 缺陷 1 回归：句级归因 ==============================
(0, node_test_1.default)('mapWordBlanks：跨句的字词空必须映射到各自句子（不得全为第 0 句）', () => {
    const sentences = [
        { text: '床前___光，疑是地上霜。', blanks: [0] },
        { text: '举头望___，低头思故乡。', blanks: [1] },
    ];
    const result = {
        sentences,
        blanks: [
            { index: 0, originalChar: '明月', position: 2 },
            { index: 1, originalChar: '明月', position: 3 },
        ],
        displayText: '床前___光，疑是地上霜。\n举头望___，低头思故乡。',
        maxBlanks: 2,
        suggestedBlanks: 2,
    };
    const blanks = (0, blankMapping_1.mapWordBlanks)(result);
    strict_1.default.equal(blanks.length, 2);
    strict_1.default.equal(blanks[0].sentenceIndex, 0, '第 1 个空属于第 0 句');
    strict_1.default.equal(blanks[1].sentenceIndex, 1, '第 2 个空属于第 1 句（此前缺陷：恒为 0）');
    strict_1.default.ok(blanks.some((b) => b.sentenceIndex > 0), '跨句时必须存在 sentenceIndex > 0 的空');
    // 句内偏移与答案长度
    strict_1.default.equal(blanks[1].startInSentence, 3);
    strict_1.default.equal(blanks[1].endInSentence, 5);
});
(0, node_test_1.default)('mapWordBlanks：真实算法输出下，句索引与句内偏移互相自洽', () => {
    const result = generateWordClozeDeterministic(MULTI, 4);
    const blanks = (0, blankMapping_1.mapWordBlanks)(result);
    const originals = (0, blankMapping_1.wordSentenceOriginals)(result.sentences, blanks);
    const sentences = sentence_1.SentenceSplitter.split(MULTI);
    strict_1.default.ok(blanks.length > 0, '应生成至少一个空');
    strict_1.default.equal(originals.length, sentences.length, '句数与原文切句一致');
    for (const b of blanks) {
        const host = originals[b.sentenceIndex];
        strict_1.default.ok(host, `空 ${b.index} 的句索引应在范围内`);
        // 用「句内偏移」做独立校验：原文该区间必须恰好等于该空的答案
        // （若 sentenceIndex 归错句，这里会立刻失败——此前缺陷即恒为第 0 句）
        strict_1.default.equal(host.slice(b.startInSentence, b.endInSentence), b.answer, `空 ${b.index} 的 [start,end) 区间应等于答案「${b.answer}」`);
        strict_1.default.ok(b.startInSentence >= 0 && b.endInSentence <= host.length);
    }
});
(0, node_test_1.default)('buildWordBlankSentenceMap：同句多个空共享同一句索引', () => {
    const sentences = [
        { text: 'A___B___C', blanks: [0, 1] },
        { text: 'D___E', blanks: [2] },
    ];
    const map = (0, blankMapping_1.buildWordBlankSentenceMap)(sentences);
    strict_1.default.equal(map.get(0), 0);
    strict_1.default.equal(map.get(1), 0);
    strict_1.default.equal(map.get(2), 1);
});
(0, node_test_1.default)('mapSentenceBlanks：句子模式直接沿用自带句索引', () => {
    const blanks = (0, blankMapping_1.mapSentenceBlanks)({
        sentences: ['甲。', '乙。'],
        blanks: [
            { index: 0, originalText: '甲', sentenceIndex: 0, startInSentence: 0, endInSentence: 1 },
            { index: 1, originalText: '乙', sentenceIndex: 1, startInSentence: 0, endInSentence: 1 },
        ],
        displayText: '[1] ___。\n[2] ___。',
    });
    strict_1.default.deepEqual(blanks.map((b) => b.sentenceIndex), [0, 1]);
});
// ============================== 缺陷 2 回归：热力图锚点 ==============================
(0, node_test_1.default)('restoreWordSentence：按顺序把 ___ 回填为答案', () => {
    const blanks = [
        { index: 0, answer: '明月', sentenceIndex: 0, startInSentence: 2, endInSentence: 4 },
        { index: 1, answer: '故乡', sentenceIndex: 1, startInSentence: 4, endInSentence: 6 },
    ];
    strict_1.default.equal((0, blankMapping_1.restoreWordSentence)('床前___光', [0], blanks), '床前明月光');
    strict_1.default.equal((0, blankMapping_1.restoreWordSentence)('低头思___', [1], blanks), '低头思故乡');
    // 同句多空按 blanks 顺序回填
    strict_1.default.equal((0, blankMapping_1.restoreWordSentence)('___照___', [0, 1], [
        { index: 0, answer: '月', sentenceIndex: 0, startInSentence: 0, endInSentence: 1 },
        { index: 1, answer: '我', sentenceIndex: 0, startInSentence: 2, endInSentence: 3 },
    ]), '月照我');
});
(0, node_test_1.default)('wordSentenceOriginals：回填后的句子应与原文切句完全一致', () => {
    const result = generateWordClozeDeterministic(MULTI, 5);
    const blanks = (0, blankMapping_1.mapWordBlanks)(result);
    const originals = (0, blankMapping_1.wordSentenceOriginals)(result.sentences, blanks);
    const expected = sentence_1.SentenceSplitter.split(MULTI);
    strict_1.default.deepEqual(originals, expected, '字词模式还原后必须与原文逐句一致（锚点匹配的前提）');
});
(0, node_test_1.default)('computeAnsweredStarts：字词模式锚点非空且落在正确字符位置', () => {
    const result = generateWordClozeDeterministic(MULTI, 5);
    const blanks = (0, blankMapping_1.mapWordBlanks)(result);
    const originals = (0, blankMapping_1.wordSentenceOriginals)(result.sentences, blanks);
    // 模拟"仅作答第 0 句的空"
    const touched = new Set([0]);
    const starts = (0, blankMapping_1.computeAnsweredStarts)(MULTI, originals, touched);
    strict_1.default.equal(starts.length, 1, '应产生 1 个锚点（此前缺陷：恒为空）');
    const expectedStart = sentence_1.SentenceSplitter.splitWithPositions(MULTI)[0].startIndex;
    strict_1.default.equal(starts[0], expectedStart);
});
(0, node_test_1.default)('computeAnsweredStarts：多句作答时按序返回多个升序锚点', () => {
    const originals = sentence_1.SentenceSplitter.split(MULTI);
    const positions = sentence_1.SentenceSplitter.splitWithPositions(MULTI);
    const starts = (0, blankMapping_1.computeAnsweredStarts)(MULTI, originals, originals.map((_, i) => i));
    strict_1.default.equal(starts.length, positions.length, '每个被作答句都应产生一个锚点');
    strict_1.default.deepEqual(starts, positions.map((s) => s.startIndex));
    // 升序（热力图按位置染色）
    strict_1.default.deepEqual(starts.slice().sort((a, b) => a - b), starts);
});
(0, node_test_1.default)('computeAnsweredStarts：段落子集（文本仍能在全文命中）对齐到全文坐标', () => {
    const full = `${MULTI}\n\n${CONTENT}`;
    const subsetOriginals = sentence_1.SentenceSplitter.split(CONTENT); // 后半段
    const starts = (0, blankMapping_1.computeAnsweredStarts)(full, subsetOriginals, [0]);
    const fullPositions = sentence_1.SentenceSplitter.splitWithPositions(full);
    const targetIndex = fullPositions.findIndex((s) => s.text === subsetOriginals[0]);
    strict_1.default.ok(targetIndex >= 0, '全文应包含该子集句');
    strict_1.default.equal(starts[0], fullPositions[targetIndex].startIndex, '应命中全文坐标而非子集内偏移');
});
(0, node_test_1.default)('computeAnsweredStarts：文本失配时回退按索引对齐，且空原文不产生锚点', () => {
    const originals = sentence_1.SentenceSplitter.split(MULTI);
    const starts = (0, blankMapping_1.computeAnsweredStarts)(MULTI, originals, [1]);
    const positions = sentence_1.SentenceSplitter.splitWithPositions(MULTI);
    strict_1.default.equal(starts[0], positions[1].startIndex);
    // 反向默写场景：originals 为空数组 → 不产生锚点
    strict_1.default.deepEqual((0, blankMapping_1.computeAnsweredStarts)(MULTI, [], [0]), []);
    // 越界索引不崩溃
    strict_1.default.deepEqual((0, blankMapping_1.computeAnsweredStarts)(MULTI, originals, [999]), []);
});
// ============================== AI 未覆盖区间的本地补齐 ==============================
(0, node_test_1.default)('unseenSentenceIndices：文本不超过 AI 上限时无未覆盖句', () => {
    strict_1.default.deepEqual((0, blankMapping_1.unseenSentenceIndices)(MULTI, 10000), []);
    strict_1.default.deepEqual((0, blankMapping_1.unseenSentenceIndices)(MULTI, MULTI.length), []);
});
(0, node_test_1.default)('unseenSentenceIndices：返回起点超过上限的句索引（长文尾部）', () => {
    const positions = sentence_1.SentenceSplitter.splitWithPositions(MULTI);
    strict_1.default.ok(positions.length >= 2, '测试文本应至少切成 2 句');
    const boundary = positions[1].startIndex; // 以第 2 句起点作为 AI 可见上限
    const unseen = (0, blankMapping_1.unseenSentenceIndices)(MULTI, boundary);
    const expected = positions.map((p, i) => (p.startIndex >= boundary ? i : -1)).filter((i) => i >= 0);
    strict_1.default.deepEqual(unseen, expected);
    strict_1.default.ok(unseen.length > 0, '长文尾部应有未被 AI 覆盖的句子');
    strict_1.default.ok(unseen.length < positions.length, '前部句子应仍由 AI 覆盖');
});
(0, node_test_1.default)('rangesFromLocalBlanks：只取指定句的本地区间，且区间为句内半开范围', () => {
    const blanks = [
        { index: 0, answer: '明月', sentenceIndex: 0, startInSentence: 2, endInSentence: 4 },
        { index: 1, answer: '霜', sentenceIndex: 1, startInSentence: 4, endInSentence: 5 },
    ];
    const ranges = (0, blankMapping_1.rangesFromLocalBlanks)(blanks, (s) => s === 1);
    strict_1.default.equal(ranges.has(0), false, '非目标句不应被补入');
    strict_1.default.deepEqual(ranges.get(1), [{ first: 4, last: 4 }]);
});
(0, node_test_1.default)('mergeRanges：AI 区间与本地补齐区间合并（同句叠加、不丢任一侧）', () => {
    var _a;
    const ai = new Map([[0, [{ first: 0, last: 1 }]]]);
    const local = new Map([
        [0, [{ first: 4, last: 4 }]],
        [2, [{ first: 0, last: 2 }]],
    ]);
    const merged = (0, blankMapping_1.mergeRanges)(ai, local);
    strict_1.default.deepEqual(merged.get(0), [
        { first: 0, last: 1 },
        { first: 4, last: 4 },
    ]);
    strict_1.default.deepEqual(merged.get(2), [{ first: 0, last: 2 }]);
    // 原 Map 不被修改
    strict_1.default.equal((_a = ai.get(0)) === null || _a === void 0 ? void 0 : _a.length, 1);
});
