// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// MemoryHeatmap（记忆热力图）测试
// 期望值逐条人工推导，并与 Python 复刻的「比例估算 + 截断」口径交叉验证。
// 颜色为 Android Compose Color(0xFF……) 照抄的十六进制 '#RRGGBB'，Color.Unspecified → ''。

import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHeatmap, type HeatmapData } from '../core/algorithms/memoryHeatmap';
import type { MistakeDetail, PracticeRecordEntity } from '../core/algorithms/types';

const CONTENT = '第一句。第二句。第三句。'; // 3 句，起始位置 0 / 4 / 8

function mistake(blankIndex: number, userAnswer = ''): MistakeDetail {
  return { blankIndex, correctAnswer: '', userAnswer, errorType: 'TYPO' };
}

function record(over: Partial<PracticeRecordEntity>): PracticeRecordEntity {
  return {
    uuid: 'r',
    articleUuid: 'a',
    mode: 'SENTENCE',
    totalBlanks: 3,
    correctCount: 0,
    mistakes: [],
    timestamp: 0,
    duration: 0,
    similarity: 0,
    rating: 0,
    weakHints: 0,
    strongHints: 0,
    answeredSentenceStarts: [],
    mistakeSentenceIndices: [],
    ...over,
  };
}

test('errorRateToColor：阈值分档（0.1/0.3/0.5/0.7 边界）', () => {
  // 恰在边界取高档
  assert.equal(MemoryHeatmap.errorRateToColor(0.7, true), '#E53935'); // 深红
  assert.equal(MemoryHeatmap.errorRateToColor(0.5, true), '#EF6C00'); // 橙
  assert.equal(MemoryHeatmap.errorRateToColor(0.3, true), '#F9A825'); // 黄
  assert.equal(MemoryHeatmap.errorRateToColor(0.1, true), '#7CB342'); // 浅绿
  // 略低于边界取低一档
  assert.equal(MemoryHeatmap.errorRateToColor(0.6999, true), '#EF6C00');
  assert.equal(MemoryHeatmap.errorRateToColor(0.4999, true), '#F9A825');
  assert.equal(MemoryHeatmap.errorRateToColor(0.2999, true), '#7CB342');
  assert.equal(MemoryHeatmap.errorRateToColor(0.0999, true), '#43A047'); // 深绿
  // 断点
  assert.equal(MemoryHeatmap.errorRateToColor(1, true), '#E53935');
  assert.equal(MemoryHeatmap.errorRateToColor(0, true), '#66BB6A'); // 翠绿（从未错过）
});

test('errorRateToColor：无历史 → 无色（Color.Unspecified 映射为 ""）', () => {
  assert.equal(MemoryHeatmap.errorRateToColor(0.9, false), '');
  assert.equal(MemoryHeatmap.errorRateToColor(0, false), '');
});

test('getLegendColors：五档图例（顺序与色值固定）', () => {
  assert.deepEqual(MemoryHeatmap.getLegendColors(), [
    ['薄弱', '#E53935'],
    ['较难', '#EF6C00'],
    ['一般', '#F9A825'],
    ['熟悉', '#7CB342'],
    ['牢固', '#43A047'],
  ]);
});

test('generate：空文章返回空结果', () => {
  assert.deepEqual(MemoryHeatmap.generate('', []), {
    sentences: [],
    overallErrorRate: 0,
    totalPractices: 0,
  } as HeatmapData);
});

test('generate：按字符起始位置锚定句子练习次数与错误率', () => {
  const r1 = record({ mistakes: [mistake(0)], answeredSentenceStarts: [0, 8] }); // 句0错1，句0/2各练1
  const r2 = record({ answeredSentenceStarts: [4] }); // 句1练1
  const data = MemoryHeatmap.generate(CONTENT, [r1, r2]);

  assert.equal(data.totalPractices, 2);
  assert.deepEqual(
    data.sentences.map((s) => [s.sentenceIndex, s.text, s.errorRate, s.heatColor, s.practiceCount]),
    [
      [0, '第一句。', 1, '#E53935', 2],
      [1, '第二句。', 0, '#66BB6A', 2],
      [2, '第三句。', 0, '#66BB6A', 2],
    ]
  );
  // 整篇错误率：错 1 / 总空 6
  assert.ok(Math.abs(data.overallErrorRate - 1 / 6) < 1e-9);
});

test('generate：未被练到的句子 → 无色（heatColor="") 且 errorRate=0', () => {
  const data = MemoryHeatmap.generate(CONTENT, [record({ answeredSentenceStarts: [0] })]);
  assert.deepEqual(
    data.sentences.map((s) => [s.sentenceIndex, s.errorRate, s.heatColor]),
    [
      [0, 0, '#66BB6A'],
      [1, 0, ''],
      [2, 0, ''],
    ]
  );
});

test('generate：无 provider 时按 blankIndex/totalBlanks 比例估算（toInt 截断）', () => {
  // blankIndex=1, totalBlanks=4 → ratio=0.25 × 3 = 0.75 → 截断 0
  const data = MemoryHeatmap.generate(CONTENT, [record({ totalBlanks: 4, mistakes: [mistake(1)] })]);
  assert.deepEqual(
    data.sentences.map((s) => [s.sentenceIndex, s.errorRate, s.heatColor]),
    [
      [0, 1, '#E53935'],
      [1, 0, '#66BB6A'],
      [2, 0, '#66BB6A'],
    ]
  );
});

test('generate：provider 归因优先于比例估算（句级错误归因）', () => {
  // userAnswer==='s2' 的错题归到句索引 1，否则归到句 0
  const provider = (m: MistakeDetail): number => (m.userAnswer === 's2' ? 1 : 0);
  const rA = record({
    mistakes: [mistake(0, 's2'), mistake(1, 'x')],
    answeredSentenceStarts: [0, 4, 8],
  });
  const rB = record({
    mistakes: [mistake(2, 's2')],
    answeredSentenceStarts: [0, 4, 8],
  });
  const data = MemoryHeatmap.generate(CONTENT, [rA, rB], provider);
  assert.deepEqual(
    data.sentences.map((s) => [s.sentenceIndex, s.errorRate, s.heatColor]),
    [
      [0, 0.5, '#EF6C00'], // 句0：1 错 / 2 练
      [1, 1, '#E53935'], // 句1：2 错 / 2 练
      [2, 0, '#66BB6A'], // 句2：0 错 / 2 练
    ]
  );
  // 整篇：错 3 / 总空 6
  assert.ok(Math.abs(data.overallErrorRate - 0.5) < 1e-9);
});

test('generate：旧记录（无 answeredSentenceStarts）回退整篇都练到', () => {
  // blanksPerSentence = floor(totalBlanks / 句数) 且至少 1 → 3/3 = 1
  // 错题 blankIndex=2 → ratio=2/3 × 3 = 2 → 归到句 2
  const data = MemoryHeatmap.generate(CONTENT, [record({ totalBlanks: 3, mistakes: [mistake(2)] })]);
  assert.equal(data.sentences[0].practiceCount, 1);
  assert.deepEqual(
    data.sentences.map((s) => [s.sentenceIndex, s.errorRate, s.heatColor]),
    [
      [0, 0, '#66BB6A'],
      [1, 0, '#66BB6A'],
      [2, 1, '#E53935'],
    ]
  );
});