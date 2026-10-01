import test from 'node:test';
import assert from 'node:assert/strict';

import { SentenceSplitter } from '../core/algorithms/sentence';
import { BlancallGenerator, WordClozeResult, WordClozeSentence } from '../core/algorithms/cloze';
import {
  buildWordBlankSentenceMap,
  computeAnsweredStarts,
  mapSentenceBlanks,
  mapWordBlanks,
  mergeRanges,
  rangesFromLocalBlanks,
  restoreWordSentence,
  unseenSentenceIndices,
  wordSentenceOriginals,
} from '../core/practice/blankMapping';

/** 固定测试文本（3 句，含中英文与标点） */
const CONTENT = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
const MULTI = '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。';

/** 在固定随机源下生成字词挖空（保证测试可复现） */
function generateWordClozeDeterministic(content: string, count = 4): WordClozeResult {
  const original = Math.random;
  Math.random = () => 0.5;
  try {
    return BlancallGenerator.generateWordCloze(content, count);
  } finally {
    Math.random = original;
  }
}

// ============================== 缺陷 1 回归：句级归因 ==============================

test('mapWordBlanks：跨句的字词空必须映射到各自句子（不得全为第 0 句）', () => {
  const sentences: WordClozeSentence[] = [
    { text: '床前___光，疑是地上霜。', blanks: [0] },
    { text: '举头望___，低头思故乡。', blanks: [1] },
  ];
  const result: WordClozeResult = {
    sentences,
    blanks: [
      { index: 0, originalChar: '明月', position: 2 },
      { index: 1, originalChar: '明月', position: 3 },
    ],
    displayText: '床前___光，疑是地上霜。\n举头望___，低头思故乡。',
    maxBlanks: 2,
    suggestedBlanks: 2,
  };

  const blanks = mapWordBlanks(result);
  assert.equal(blanks.length, 2);
  assert.equal(blanks[0].sentenceIndex, 0, '第 1 个空属于第 0 句');
  assert.equal(blanks[1].sentenceIndex, 1, '第 2 个空属于第 1 句（此前缺陷：恒为 0）');
  assert.ok(
    blanks.some((b) => b.sentenceIndex > 0),
    '跨句时必须存在 sentenceIndex > 0 的空'
  );
  // 句内偏移与答案长度
  assert.equal(blanks[1].startInSentence, 3);
  assert.equal(blanks[1].endInSentence, 5);
});

test('mapWordBlanks：真实算法输出下，句索引与句内偏移互相自洽', () => {
  const result = generateWordClozeDeterministic(MULTI, 4);
  const blanks = mapWordBlanks(result);
  const originals = wordSentenceOriginals(result.sentences, blanks);
  const sentences = SentenceSplitter.split(MULTI);

  assert.ok(blanks.length > 0, '应生成至少一个空');
  assert.equal(originals.length, sentences.length, '句数与原文切句一致');
  for (const b of blanks) {
    const host = originals[b.sentenceIndex];
    assert.ok(host, `空 ${b.index} 的句索引应在范围内`);
    // 用「句内偏移」做独立校验：原文该区间必须恰好等于该空的答案
    // （若 sentenceIndex 归错句，这里会立刻失败——此前缺陷即恒为第 0 句）
    assert.equal(
      host.slice(b.startInSentence, b.endInSentence),
      b.answer,
      `空 ${b.index} 的 [start,end) 区间应等于答案「${b.answer}」`
    );
    assert.ok(b.startInSentence >= 0 && b.endInSentence <= host.length);
  }
});

test('buildWordBlankSentenceMap：同句多个空共享同一句索引', () => {
  const sentences: WordClozeSentence[] = [
    { text: 'A___B___C', blanks: [0, 1] },
    { text: 'D___E', blanks: [2] },
  ];
  const map = buildWordBlankSentenceMap(sentences);
  assert.equal(map.get(0), 0);
  assert.equal(map.get(1), 0);
  assert.equal(map.get(2), 1);
});

test('mapSentenceBlanks：句子模式直接沿用自带句索引', () => {
  const blanks = mapSentenceBlanks({
    sentences: ['甲。', '乙。'],
    blanks: [
      { index: 0, originalText: '甲', sentenceIndex: 0, startInSentence: 0, endInSentence: 1 },
      { index: 1, originalText: '乙', sentenceIndex: 1, startInSentence: 0, endInSentence: 1 },
    ],
    displayText: '[1] ___。\n[2] ___。',
  });
  assert.deepEqual(
    blanks.map((b) => b.sentenceIndex),
    [0, 1]
  );
});

// ============================== 缺陷 2 回归：热力图锚点 ==============================

test('restoreWordSentence：按顺序把 ___ 回填为答案', () => {
  const blanks = [
    { index: 0, answer: '明月', sentenceIndex: 0, startInSentence: 2, endInSentence: 4 },
    { index: 1, answer: '故乡', sentenceIndex: 1, startInSentence: 4, endInSentence: 6 },
  ];
  assert.equal(restoreWordSentence('床前___光', [0], blanks), '床前明月光');
  assert.equal(restoreWordSentence('低头思___', [1], blanks), '低头思故乡');
  // 同句多空按 blanks 顺序回填
  assert.equal(restoreWordSentence('___照___', [0, 1], [
    { index: 0, answer: '月', sentenceIndex: 0, startInSentence: 0, endInSentence: 1 },
    { index: 1, answer: '我', sentenceIndex: 0, startInSentence: 2, endInSentence: 3 },
  ] as never), '月照我');
});

test('wordSentenceOriginals：回填后的句子应与原文切句完全一致', () => {
  const result = generateWordClozeDeterministic(MULTI, 5);
  const blanks = mapWordBlanks(result);
  const originals = wordSentenceOriginals(result.sentences, blanks);
  const expected = SentenceSplitter.split(MULTI);
  assert.deepEqual(originals, expected, '字词模式还原后必须与原文逐句一致（锚点匹配的前提）');
});

test('computeAnsweredStarts：字词模式锚点非空且落在正确字符位置', () => {
  const result = generateWordClozeDeterministic(MULTI, 5);
  const blanks = mapWordBlanks(result);
  const originals = wordSentenceOriginals(result.sentences, blanks);

  // 模拟"仅作答第 0 句的空"
  const touched = new Set<number>([0]);
  const starts = computeAnsweredStarts(MULTI, originals, touched);

  assert.equal(starts.length, 1, '应产生 1 个锚点（此前缺陷：恒为空）');
  const expectedStart = SentenceSplitter.splitWithPositions(MULTI)[0].startIndex;
  assert.equal(starts[0], expectedStart);
});

test('computeAnsweredStarts：多句作答时按序返回多个升序锚点', () => {
  const originals = SentenceSplitter.split(MULTI);
  const positions = SentenceSplitter.splitWithPositions(MULTI);
  const starts = computeAnsweredStarts(
    MULTI,
    originals,
    originals.map((_, i) => i)
  );
  assert.equal(starts.length, positions.length, '每个被作答句都应产生一个锚点');
  assert.deepEqual(starts, positions.map((s) => s.startIndex));
  // 升序（热力图按位置染色）
  assert.deepEqual(starts.slice().sort((a, b) => a - b), starts);
});

test('computeAnsweredStarts：段落子集（文本仍能在全文命中）对齐到全文坐标', () => {
  const full = `${MULTI}\n\n${CONTENT}`;
  const subsetOriginals = SentenceSplitter.split(CONTENT); // 后半段
  const starts = computeAnsweredStarts(full, subsetOriginals, [0]);
  const fullPositions = SentenceSplitter.splitWithPositions(full);
  const targetIndex = fullPositions.findIndex((s) => s.text === subsetOriginals[0]);
  assert.ok(targetIndex >= 0, '全文应包含该子集句');
  assert.equal(starts[0], fullPositions[targetIndex].startIndex, '应命中全文坐标而非子集内偏移');
});

test('computeAnsweredStarts：文本失配时回退按索引对齐，且空原文不产生锚点', () => {
  const originals = SentenceSplitter.split(MULTI);
  const starts = computeAnsweredStarts(MULTI, originals, [1]);
  const positions = SentenceSplitter.splitWithPositions(MULTI);
  assert.equal(starts[0], positions[1].startIndex);

  // 反向默写场景：originals 为空数组 → 不产生锚点
  assert.deepEqual(computeAnsweredStarts(MULTI, [], [0]), []);
  // 越界索引不崩溃
  assert.deepEqual(computeAnsweredStarts(MULTI, originals, [999]), []);
});

// ============================== AI 未覆盖区间的本地补齐 ==============================

test('unseenSentenceIndices：文本不超过 AI 上限时无未覆盖句', () => {
  assert.deepEqual(unseenSentenceIndices(MULTI, 10000), []);
  assert.deepEqual(unseenSentenceIndices(MULTI, MULTI.length), []);
});

test('unseenSentenceIndices：返回起点超过上限的句索引（长文尾部）', () => {
  const positions = SentenceSplitter.splitWithPositions(MULTI);
  assert.ok(positions.length >= 2, '测试文本应至少切成 2 句');
  const boundary = positions[1].startIndex; // 以第 2 句起点作为 AI 可见上限
  const unseen = unseenSentenceIndices(MULTI, boundary);
  const expected = positions.map((p, i) => (p.startIndex >= boundary ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(unseen, expected);
  assert.ok(unseen.length > 0, '长文尾部应有未被 AI 覆盖的句子');
  assert.ok(unseen.length < positions.length, '前部句子应仍由 AI 覆盖');
});

test('rangesFromLocalBlanks：只取指定句的本地区间，且区间为句内半开范围', () => {
  const blanks = [
    { index: 0, answer: '明月', sentenceIndex: 0, startInSentence: 2, endInSentence: 4 },
    { index: 1, answer: '霜', sentenceIndex: 1, startInSentence: 4, endInSentence: 5 },
  ];
  const ranges = rangesFromLocalBlanks(blanks, (s) => s === 1);
  assert.equal(ranges.has(0), false, '非目标句不应被补入');
  assert.deepEqual(ranges.get(1), [{ first: 4, last: 4 }]);
});

test('mergeRanges：AI 区间与本地补齐区间合并（同句叠加、不丢任一侧）', () => {
  const ai = new Map<number, Array<{ first: number; last: number }>>([[0, [{ first: 0, last: 1 }]]]);
  const local = new Map<number, Array<{ first: number; last: number }>>([
    [0, [{ first: 4, last: 4 }]],
    [2, [{ first: 0, last: 2 }]],
  ]);
  const merged = mergeRanges(ai, local);
  assert.deepEqual(merged.get(0), [
    { first: 0, last: 1 },
    { first: 4, last: 4 },
  ]);
  assert.deepEqual(merged.get(2), [{ first: 0, last: 2 }]);
  // 原 Map 不被修改
  assert.equal(ai.get(0)?.length, 1);
});