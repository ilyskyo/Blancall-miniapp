import test from 'node:test';
import assert from 'node:assert/strict';
import { DifficultyCalculator } from '../core/algorithms/difficulty';

// 与 Kotlin `DifficultyCalculator` 同款公式：
// difficulty = 笔画难度 * 0.7 + 生僻程度 * 0.3
//   笔画难度 = min(strokes / 30, 1)；未知字笔画默认 10
//   生僻程度 = 高频常用字 0.1 / 其余 0.5
function expectDiff(strokes: number, highFreq: boolean): number {
  const strokeScore = Math.min(strokes / 30, 1);
  return strokeScore * 0.7 + (highFreq ? 0.1 : 0.5) * 0.3;
}

function close(actual: number, expected: number, msg?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${msg ?? ''} actual=${actual} expected=${expected}`);
}

test('calculateCharDifficulty：高频字按真实笔画数给你值', () => {
  // 一 = 1 画且高频；的 = 8 画且高频
  close(DifficultyCalculator.calculateCharDifficulty('一'), expectDiff(1, true), '一');
  close(DifficultyCalculator.calculateCharDifficulty('的'), expectDiff(8, true), '的');
  // 明 = 8 画（高频），月 = 4 画（高频）
  close(DifficultyCalculator.calculateCharDifficulty('明'), expectDiff(8, true), '明');
  close(DifficultyCalculator.calculateCharDifficulty('月'), expectDiff(4, true), '月');
});

test('calculateCharDifficulty：非高频字按真实笔画数给你值', () => {
  // 霜 = 17 画，非高频字
  close(DifficultyCalculator.calculateCharDifficulty('霜'), expectDiff(17, false), '霜');
  // 床 = 7 画，非高频字
  close(DifficultyCalculator.calculateCharDifficulty('床'), expectDiff(7, false), '床');
});

test('calculateCharDifficulty：未知汉字默认 10 画（生僻感偏高）', () => {
  // 鑫 / 龘 均未收录笔画表 → 默认 10 画、非高频
  close(DifficultyCalculator.calculateCharDifficulty('鑫'), expectDiff(10, false), '鑫');
  close(DifficultyCalculator.calculateCharDifficulty('龘'), expectDiff(10, false), '龘');
  // 扩展 A 区（U+3400..U+4DBF）同样按汉字处理，未收录 → 10 画
  close(DifficultyCalculator.calculateCharDifficulty('㐀'), expectDiff(10, false), '㐀');
  assert.equal(DifficultyCalculator.calculateCharDifficulty('鑫'), DifficultyCalculator.calculateCharDifficulty('龘'));
});

test('calculateCharDifficulty：非中文字符固定低难度 0.2', () => {
  for (const ch of ['a', 'Z', '1', '，', '。', ' ', '😀', '\u0000']) {
    assert.equal(DifficultyCalculator.calculateCharDifficulty(ch), 0.2, `非汉字 ${JSON.stringify(ch)}`);
  }
});

test('rankByDifficulty：按难度降序且稳定，历史错字 +0.5（上限 1）', () => {
  // 一(0.053) < 鑫(0.383) < 霜(0.547)
  const plain = DifficultyCalculator.rankByDifficulty(['一', '鑫', '霜']);
  assert.deepEqual(
    plain.map((it) => it[0]),
    ['霜', '鑫', '一']
  );
  close(plain[0][1], expectDiff(17, false), '霜');
  close(plain[2][1], expectDiff(1, true), '一');

  // 历史错字「一」+0.5 → 0.053+0.5=0.553 反超霜(0.547)
  const withHistory = DifficultyCalculator.rankByDifficulty(['一', '鑫', '霜'], new Set(['一']));
  assert.deepEqual(
    withHistory.map((it) => it[0]),
    ['一', '霜', '鑫']
  );
  close(withHistory[0][1], expectDiff(1, true) + 0.5, '一(+0.5)');
});

test('rankByDifficulty：难度相同时保持输入相对顺序（稳定排序）', () => {
  const a = DifficultyCalculator.rankByDifficulty(['鑫', '龘']);
  assert.deepEqual(
    a.map((it) => it[0]),
    ['鑫', '龘']
  );
  const b = DifficultyCalculator.rankByDifficulty(['龘', '鑫']);
  assert.deepEqual(
    b.map((it) => it[0]),
    ['龘', '鑫']
  );
});

test('rankByDifficulty：+0.5 后不超过上限 1', () => {
  // 不存在的极高难度：直接用 10 画未知字 0.383 + 0.5 = 0.883
  const r = DifficultyCalculator.rankByDifficulty(['鑫'], new Set(['鑫']));
  close(r[0][1], Math.min(expectDiff(10, false) + 0.5, 1));
});