import test from 'node:test';
import assert from 'node:assert/strict';
import { BlancallGenerator } from '../core/algorithms/cloze';
import { SentenceSplitter } from '../core/algorithms/sentence';
import { emptyErrorProfile } from '../core/algorithms/types';

const B = BlancallGenerator;

/** 用固定值替换 Math.random，让随机采样/打散可复现；结束后恢复 */
function withRandom<T>(value: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/** 断言：同一句内空区间互不重叠（半开区间 [start,end)） */
function assertNoOverlap(blanks: Array<{ sentenceIndex: number; startInSentence: number; endInSentence: number }>): void {
  const bySentence = new Map<number, Array<[number, number]>>();
  for (const b of blanks) {
    const list = bySentence.get(b.sentenceIndex) ?? [];
    list.push([b.startInSentence, b.endInSentence]);
    bySentence.set(b.sentenceIndex, list);
  }
  for (const list of bySentence.values()) {
    list.sort((a, b2) => a[0] - b2[0]);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i][0] >= list[i - 1][1], `区间重叠: ${JSON.stringify(list)}`);
    }
  }
}

// ══════════════════════ 句子挖空 ══════════════════════

test('句子挖空：totalClauses==1 → 自动挖 1 个空（整句）', () => {
  const r = B.generateSentenceCloze('床前明月光。');
  assert.deepEqual(r.sentences, ['床前明月光。']);
  assert.equal(r.blanks.length, 1);
  assert.deepEqual(r.blanks[0], {
    index: 0,
    originalText: '床前明月光。',
    sentenceIndex: 0,
    startInSentence: 0,
    endInSentence: 6,
  });
  assert.equal(r.displayText, '[1] ___');
});

test('句子挖空：totalClauses<=4 → max(1, n/2)（n=3 →1，n=4 →2）', () => {
  const t3 = withRandom(0, () => B.generateSentenceCloze('一，二，三。'));
  assert.equal(t3.blanks.length, 1);
  assert.deepEqual(t3.blanks[0], {
    index: 0,
    originalText: '一',
    sentenceIndex: 0,
    startInSentence: 0,
    endInSentence: 1,
  });
  assert.equal(t3.displayText, '[1] ___\n二\n三。');

  const t4 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。'));
  assert.equal(t4.blanks.length, 2);
  assert.deepEqual(
    t4.blanks.map((b) => b.sentenceIndex),
    [0, 1]
  );
  assert.equal(t4.displayText, '[1] ___\n[2] ___\n三\n四。');
});

test('句子挖空：totalClauses>4 → max(1, n/3)（n=6 →2，n=9 →3）', () => {
  const t6 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四，五，六。'));
  assert.equal(t6.blanks.length, 2);
  const t9 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四，五，六，七，八，九。'));
  assert.equal(t9.blanks.length, 3);
});

test('句子挖空：指定 count 时 clamp 到 [1, total]，且 densityScale 恒为 1', () => {
  // count=10 但只有 4 个分句 → 收敛为 4
  const c10 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 10));
  assert.equal(c10.blanks.length, 4);

  // count 指定时不受 memoryFactor 放大
  const ep16 = emptyErrorProfile(1.6);
  const c2 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 2, ep16));
  assert.equal(c2.blanks.length, 2);
});

test('句子挖空：自动档受 memoryFactor 影响（1.6 → baseCount*1.6 截断）', () => {
  // 4 分句：baseCount=2；mf=1 → 2 个空；mf=1.6 → trunc(3.2)=3 个空
  const mf1 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 0, emptyErrorProfile(1)));
  assert.equal(mf1.blanks.length, 2);
  const mf16 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 0, emptyErrorProfile(1.6)));
  assert.equal(mf16.blanks.length, 3);
  // memoryFactor 上限 1.6（传 2.0 仍按 1.6）
  const mf2 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 0, emptyErrorProfile(2)));
  assert.equal(mf2.blanks.length, 3);
});

test('句子挖空：WEAKNESS_FOCUS 有句级数据时优先薄弱句（确定性）', () => {
  const ep = emptyErrorProfile();
  ep.sentenceErrorRates = { 0: 0.1, 1: 0.9 };
  const r = B.generateSentenceCloze('春眠，处处，夜来。风。', 2, ep, 'WEAKNESS_FOCUS');
  assert.deepEqual(
    r.blanks.map((b) => b.originalText),
    ['春眠，', '风。']
  );
  assert.deepEqual(
    r.blanks.map((b) => b.sentenceIndex),
    [0, 1]
  );

  const r1 = B.generateSentenceCloze('春眠，处处，夜来。风。', 1, ep, 'WEAKNESS_FOCUS');
  assert.equal(r1.blanks.length, 1);
  assert.equal(r1.blanks[0].originalText, '风。');
  assert.equal(r1.blanks[0].sentenceIndex, 1);
});

test('句子挖空：FULL_COVERAGE 均匀铺开（确定性，取 {0,2}）', () => {
  const r = B.generateSentenceCloze('春眠，处处，夜来。风。', 2, emptyErrorProfile(), 'FULL_COVERAGE');
  assert.deepEqual(
    r.blanks.map((b) => [b.originalText, b.startInSentence, b.endInSentence]),
    [
      ['春眠，', 0, 3],
      ['夜来。', 6, 9],
    ]
  );
  assert.equal(r.displayText, '[1] ___处处，[2] ___\n风。');
  assertNoOverlap(r.blanks);
});

test('句子挖空：BALANCED 与 FULL_COVERAGE 选题不同，且相邻分句合并为复句', () => {
  // 固定 random=0 → 均衡策略每次取剩余权重最低序位 → 选中 {0,1}（同一句内相邻 → 合并）
  const balanced = withRandom(0, () => B.generateSentenceCloze('春眠，处处，夜来。风。', 2, emptyErrorProfile(), 'BALANCED'));
  assert.equal(balanced.blanks.length, 1);
  assert.deepEqual(balanced.blanks[0], {
    index: 0,
    originalText: '春眠，处处，',
    sentenceIndex: 0,
    startInSentence: 0,
    endInSentence: 6,
  });
  assert.equal(balanced.displayText, '[1] ___夜来。\n风。');

  // 全覆盖策略取 {0,2}（同一句内不相邻 → 不合并，两个独立空）
  const full = B.generateSentenceCloze('春眠，处处，夜来。风。', 2, emptyErrorProfile(), 'FULL_COVERAGE');
  assert.equal(full.blanks.length, 2);
});

test('句子挖空：同一句内相邻分句合并（床前，月。 count=2 → 整句合并）', () => {
  const r = B.generateSentenceCloze('床前，月。', 2);
  assert.deepEqual(r.sentences, ['床前，月。']);
  assert.equal(r.blanks.length, 1);
  assert.deepEqual(r.blanks[0], {
    index: 0,
    originalText: '床前，月。',
    sentenceIndex: 0,
    startInSentence: 0,
    endInSentence: 5,
  });
  assert.equal(r.displayText, '[1] ___');
});

// ══════════════════════ 字词挖空 ══════════════════════

test('字词挖空：suggestedBlanks 分档（≤3/≤10/≤30/≤80/其他）', () => {
  const cases: Array<[number, number]> = [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 2], // max(2, 4/2)
    [8, 4], // max(2, 8/2)
    [10, 5], // max(2, 10/2)
    [11, 3], // max(3, 11/3)
    [12, 4], // max(3, 12/3)
    [30, 10], // max(3, 30/3)
    [31, 6], // max(4, 31/5)
    [80, 16], // max(4, 80/5)
    [81, 10], // max(5, 81/8)
    [100, 12], // max(5, 100/8)
  ];
  for (const [n, expected] of cases) {
    const r = B.generateWordCloze('一'.repeat(n));
    assert.equal(r.maxBlanks, n, `maxBlanks n=${n}`);
    assert.equal(r.suggestedBlanks, expected, `suggestedBlanks n=${n}`);
  }
});

test('字词挖空：maxBlanks = 汉字数 + 英文单词数，且贪心选取不重叠', () => {
  const r = B.generateWordCloze('Hello 汉字 world', 4);
  assert.equal(r.maxBlanks, 4);
  assert.equal(r.suggestedBlanks, 2);
  assert.deepEqual(r.blanks, [
    { index: 0, originalChar: 'Hello', position: 0 },
    { index: 1, originalChar: '汉', position: 6 },
    { index: 2, originalChar: '字', position: 7 },
    { index: 3, originalChar: 'world', position: 9 },
  ]);
  assert.equal(r.displayText, '___ ______ ___');
  assert.deepEqual(r.sentences, [{ text: '___ ______ ___', blanks: [0, 1, 2, 3] }]);

  // 所有候选互不重叠（按原文位置区间检查）
  const ranges = r.blanks.map((b) => [b.position, b.position + b.originalChar.length]);
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    assert.ok(ranges[i][0] >= ranges[i - 1][1], `字词空重叠: ${JSON.stringify(ranges)}`);
  }
});

test('字词挖空：自动档（count=0）按 maxBlanks 分档并合并相邻空', () => {
  // maxBlanks=5 → 取全部选中项（5 个单字）→ 排序后相邻合并为整句一个空
  const r5 = B.generateWordCloze('床前明月光');
  assert.equal(r5.maxBlanks, 5);
  assert.deepEqual(r5.blanks, [{ index: 0, originalChar: '床前明月光', position: 0 }]);
  assert.equal(r5.displayText, '___');

  // maxBlanks=20 → max(1, 20/3)=6 → 前 6 个单字相邻合并为 6 字空
  const r20 = B.generateWordCloze('一'.repeat(20));
  assert.deepEqual(r20.blanks, [{ index: 0, originalChar: '一一一一一一', position: 0 }]);

  // maxBlanks=24 → max(1, 24/4)=6（>20 档）
  const r24 = B.generateWordCloze('一'.repeat(24));
  assert.deepEqual(r24.blanks, [{ index: 0, originalChar: '一一一一一一', position: 0 }]);
});

test('字词挖空：指定数够用时直接截取（不合并）', () => {
  // 无错误历史：贪心选中 5 个单字，取难度前 4 → 床/前/明/光
  const r = B.generateWordCloze('床前明月光', 4);
  assert.deepEqual(r.blanks, [
    { index: 0, originalChar: '床', position: 0 },
    { index: 1, originalChar: '前', position: 1 },
    { index: 2, originalChar: '明', position: 2 },
    { index: 3, originalChar: '光', position: 4 },
  ]);
});

test('字词挖空：指定数不足时走补齐/全单字重选路径', () => {
  const ep = emptyErrorProfile();
  // 词级错误把「明月」抬成最高难度 → 贪心选中占位过多 → 触发补充/重选
  ep.wordErrorRates = { 明月: 1 };

  // count=4 → 目标 <= 贪心选中数(4) → 保留多字词「明月」
  const r4 = B.generateWordCloze('床前明月光', 4, ep);
  assert.deepEqual(r4.blanks, [
    { index: 0, originalChar: '床', position: 0 },
    { index: 1, originalChar: '前', position: 1 },
    { index: 2, originalChar: '明月', position: 2 },
    { index: 3, originalChar: '光', position: 4 },
  ]);

  // count=5 → 贪心多字占位过多导致候选不足 → 全部改用单字重选（5 个单字）
  const r5 = B.generateWordCloze('床前明月光', 5, ep);
  assert.deepEqual(r5.blanks, [
    { index: 0, originalChar: '床', position: 0 },
    { index: 1, originalChar: '前', position: 1 },
    { index: 2, originalChar: '明', position: 2 },
    { index: 3, originalChar: '月', position: 3 },
    { index: 4, originalChar: '光', position: 4 },
  ]);

  // count 超过 maxBlanks → clamp 到 5
  const rc = B.generateWordCloze('床前明月光', 99);
  assert.equal(rc.blanks.length, 5);
});

test('字词挖空：候选为空时原样返回（无中英文可挖）', () => {
  const r = B.generateWordCloze('123，456。');
  assert.equal(r.blanks.length, 0);
  assert.equal(r.maxBlanks, 0);
  assert.equal(r.suggestedBlanks, 0);
  assert.equal(r.displayText, '123，456。');
});

// ══════════════════════ 反向默写 ══════════════════════

test('反向默写：分句切分 + 每分句挖 1 空 + 打散（含确定性样例）', () => {
  const r = withRandom(0, () => B.generateDictation('床前明月光，疑是地上霜。'));
  assert.deepEqual(r.clauses, ['床前明月光，', '疑是地上霜。']);
  assert.equal(r.shuffledClauses.length, 2);
  // 固定 random=0 的 Fisher-Yates 结果：[1, 0]
  assert.deepEqual(
    r.shuffledClauses.map((s) => s.displayOrder),
    [0, 1]
  );
  assert.deepEqual(
    r.shuffledClauses.map((s) => s.originalIndex),
    [1, 0]
  );
  assert.equal(r.shuffledClauses[0].originalText, '疑是地上霜。');
  assert.equal(r.shuffledClauses[0].displayText, '疑是地上___。');
  assert.equal(r.shuffledClauses[1].originalText, '床前明月光，');
  assert.equal(r.shuffledClauses[1].displayText, '___前明月光，');
});

test('反向默写：打散结果是原文分句的一个排列', () => {
  const src = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
  const r = B.generateDictation(src);
  assert.equal(r.clauses.length, 4);
  assert.deepEqual(r.clauses, ['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
  const idx = r.shuffledClauses.map((s) => s.originalIndex).sort((a, b) => a - b);
  assert.deepEqual(idx, [0, 1, 2, 3]);
  for (const s of r.shuffledClauses) {
    assert.equal(s.originalText, r.clauses[s.originalIndex]);
    assert.ok(s.displayText.includes('___'), '挖空分句应含 ___');
  }
});

test('反向默写：buildCustomDictation 只保留选中句', () => {
  const src = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
  const r = B.buildCustomDictation(src, new Set([1]));
  assert.deepEqual(r.clauses, ['举头望明月，', '低头思故乡。']);
  assert.equal(r.shuffledClauses.length, 2);

  // 空集合 → 空结果
  assert.deepEqual(B.buildCustomDictation(src, new Set()), { clauses: [], shuffledClauses: [] });
  // 空白文本 → 空结果
  assert.deepEqual(B.generateDictation('   '), { clauses: [], shuffledClauses: [] });
});

test('反向默写：切分标点保留在前一分句末尾', () => {
  const r = withRandom(0, () => B.generateDictation('春眠不觉晓，处处闻啼鸟；夜来风雨声，花落知多少。'));
  assert.deepEqual(r.clauses, ['春眠不觉晓，', '处处闻啼鸟；', '夜来风雨声，', '花落知多少。']);
});

// ══════════════════════ 自定义句子挖空 ══════════════════════

test('buildCustomSentenceCloze：按句内区间构造，displayText 用 [N] ___ 标记', () => {
  const r = B.buildCustomSentenceCloze(
    '床前明月光，疑是地上霜。',
    new Map([[0, [{ first: 0, last: 2 }, { first: 4, last: 4 }]]])
  );
  assert.deepEqual(r.blanks, [
    { index: 0, originalText: '床前明', sentenceIndex: 0, startInSentence: 0, endInSentence: 3 },
    { index: 1, originalText: '光', sentenceIndex: 0, startInSentence: 4, endInSentence: 5 },
  ]);
  assert.equal(r.displayText, '[1] ___月[2] ___，疑是地上霜。');
  assertNoOverlap(r.blanks);
});

test('buildCustomSentenceCloze：相邻/重叠区间自动合并，越界自动裁剪', () => {
  // 相邻区间 [0,2] 与 [3,4] 合并为 [0,4]
  const merged = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map([[0, [{ first: 0, last: 2 }, { first: 3, last: 4 }]]]));
  assert.deepEqual(merged.blanks, [
    { index: 0, originalText: '床前明月光', sentenceIndex: 0, startInSentence: 0, endInSentence: 5 },
  ]);
  assert.equal(merged.displayText, '[1] ___，疑是地上霜。');

  // 越界区间裁剪到句长；不存在的句索引被忽略
  const clamped = B.buildCustomSentenceCloze(
    '床前明月光，疑是地上霜。',
    new Map([
      [0, [{ first: 0, last: 100 }]],
      [5, [{ first: 0, last: 2 }]],
    ])
  );
  assert.deepEqual(clamped.blanks, [
    { index: 0, originalText: '床前明月光，疑是地上霜。', sentenceIndex: 0, startInSentence: 0, endInSentence: 12 },
  ]);
  assert.equal(clamped.displayText, '[1] ___');

  // 空选择 → 无空、displayText 为原文
  const empty = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map());
  assert.deepEqual(empty.blanks, []);
  assert.equal(empty.displayText, '床前明月光，疑是地上霜。');
});

// ══════════════════════ 虚词 ══════════════════════

test('isFunctionWord：单字查表，多字看首尾字', () => {
  assert.equal(B.isFunctionWord('之'), true);
  assert.equal(B.isFunctionWord('者'), true);
  assert.equal(B.isFunctionWord('的'), true);
  assert.equal(B.isFunctionWord(''), false);
  assert.equal(B.isFunctionWord('明月'), false);
  assert.equal(B.isFunctionWord('明月光'), false);
  // 首字虚词 → true
  assert.equal(B.isFunctionWord('之所'), true);
  // 尾字虚词 → true
  assert.equal(B.isFunctionWord('求之'), true);
});

// ══════════════════════ JSON 序列化 ══════════════════════

test('JSON key 名与 Kotlin org.json 输出逐字一致', () => {
  const s = B.generateSentenceCloze('床前，月。', 2);
  const so = JSON.parse(B.sentenceClozeToJson(s));
  assert.deepEqual(Object.keys(so), ['sentences', 'blanks', 'displayText']);
  assert.deepEqual(Object.keys(so.blanks[0]), ['index', 'originalText', 'sentenceIndex', 'startInSentence', 'endInSentence']);

  const w = B.generateWordCloze('Hello 汉字 world', 4);
  const wo = JSON.parse(B.wordClozeToJson(w));
  assert.deepEqual(Object.keys(wo), ['sentences', 'blanks', 'displayText', 'maxBlanks', 'suggestedBlanks']);
  assert.deepEqual(Object.keys(wo.sentences[0]), ['text', 'blanks']);
  assert.deepEqual(Object.keys(wo.blanks[0]), ['index', 'originalChar', 'position']);

  const d = withRandom(0, () => B.generateDictation('床前明月光，疑是地上霜。'));
  const do_ = JSON.parse(B.dictationToJson(d));
  assert.deepEqual(Object.keys(do_), ['clauses', 'shuffledClauses']);
  assert.deepEqual(Object.keys(do_.shuffledClauses[0]), ['displayOrder', 'originalIndex', 'originalText', 'displayText']);
});

test('JSON 往返：xxxFromJson(xxxToJson(r)) 与 r 深度相等', () => {
  const s = B.generateSentenceCloze('床前明月光，疑是地上霜。', 2);
  assert.deepEqual(B.sentenceClozeFromJson(B.sentenceClozeToJson(s)), s);

  const w = B.generateWordCloze('Hello 汉字 world', 4);
  assert.deepEqual(B.wordClozeFromJson(B.wordClozeToJson(w)), w);

  const d = withRandom(0.37, () => B.generateDictation('床前明月光，疑是地上霜。举头望明月。'));
  assert.deepEqual(B.dictationFromJson(B.dictationToJson(d)), d);

  const custom = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map([[0, [{ first: 0, last: 2 }]]]));
  assert.deepEqual(B.sentenceClozeFromJson(B.sentenceClozeToJson(custom)), custom);
});

test('JSON 反序列化：非法输入返回 null', () => {
  assert.equal(B.sentenceClozeFromJson('{bad json'), null);
  assert.equal(B.sentenceClozeFromJson('{"sentences":[]}'), null); // 缺 blanks/displayText
  assert.equal(B.wordClozeFromJson('[]'), null);
  assert.equal(B.wordClozeFromJson('{"sentences":[],"blanks":[],"displayText":"","maxBlanks":1}'), null); // 缺 suggestedBlanks
  assert.equal(B.dictationFromJson('null'), null);
  assert.equal(B.dictationFromJson('{"clauses":[]}'), null); // 缺 shuffledClauses
});

// ══════════════════════ 分句器（依赖） ══════════════════════

test('SentenceSplitter.split/splitWithPositions 供挖空使用', () => {
  const text = '床前明月光，疑是地上霜。举头望明月。';
  assert.deepEqual(SentenceSplitter.split(text), ['床前明月光，疑是地上霜。', '举头望明月。']);
  assert.deepEqual(SentenceSplitter.splitWithPositions(text), [
    { text: '床前明月光，疑是地上霜。', startIndex: 0, endIndex: 12 },
    { text: '举头望明月。', startIndex: 12, endIndex: 18 },
  ]);
});