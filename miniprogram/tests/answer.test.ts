import test from 'node:test';
import assert from 'node:assert/strict';
import { AnswerChecker, check, checkDictation } from '../core/algorithms/answer';
import type { DictationCheckResult } from '../core/algorithms/answer';

// 期望值由 Python 独立复刻 AnswerChecker.kt 生成（见报告），为固定样例；
// 相似度允许 ±1e-6 误差（Kotlin Float ↔ TS number 精度差）。
const EPS = 1e-6;
function close(actual: number, expected: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= EPS,
    `${msg ?? ''} 期望 ${expected}，实际 ${actual}`,
  );
}

// ── check ────────────────────────────────────────────────────────────────
interface CheckCase {
  name: string;
  correct: string;
  user: string;
  result: string;
  similarity: number;
  message: string;
}

const CHECK_CASES: CheckCase[] = [
  { name: '空输入', correct: '春眠不觉晓', user: '', result: 'MISSING', similarity: 0, message: '未作答' },
  { name: '仅空白', correct: '春眠不觉晓', user: '   ', result: 'MISSING', similarity: 0, message: '未作答' },
  { name: '完全相同', correct: '春眠不觉晓', user: '春眠不觉晓', result: 'CORRECT', similarity: 1, message: '正确' },
  { name: '首尾空白被 trim', correct: '  春眠不觉晓  ', user: '春眠不觉晓', result: 'CORRECT', similarity: 1, message: '正确' },
  {
    name: '标点差异（漏句号）', correct: '春眠不觉晓。', user: '春眠不觉晓',
    result: 'CORRECT', similarity: 1, message: '正确（漏了标点「。」）',
  },
  {
    name: '标点差异（多标点）', correct: '春眠不觉晓', user: '春眠不觉晓！',
    result: 'CORRECT', similarity: 1, message: '正确（多了标点「！」）',
  },
  {
    name: '全半角+大小写（英文）', correct: 'ＡＢＣ', user: 'abc',
    result: 'CORRECT', similarity: 1, message: '正确（标点略有差异）',
  },
  {
    name: '英文大小写', correct: 'HELLO', user: 'hello',
    result: 'CORRECT', similarity: 1, message: '正确（标点略有差异）',
  },
  {
    name: '空白差异', correct: 'a b c', user: 'abc',
    result: 'CORRECT', similarity: 1, message: '正确（漏了标点「  」）',
  },
  {
    name: '纯标点（核心皆空）', correct: '。', user: '，，',
    result: 'CORRECT', similarity: 1, message: '正确',
  },
  {
    name: '少字 MISSING', correct: '春眠不觉晓处处闻啼鸟', user: '春眠不觉晓处处闻啼',
    result: 'MISSING', similarity: 1 - 1 / 10, message: '少字（差异「鸟」→「」）（缺 1 个字）',
  },
  {
    name: '多字 EXTRA', correct: '春眠不觉晓', user: '春眠不觉晓处处',
    result: 'EXTRA', similarity: 1 - 2 / 7, message: '多字（差异「」→「处处」）（多了 2 个字）',
  },
  {
    name: '乱序 WRONG_ORDER', correct: '明月光', user: '月明光',
    result: 'WRONG_ORDER', similarity: 1 - 2 / 3, message: '顺序错误（字都对，但顺序不对）',
  },
  {
    name: '错别字 TYPO', correct: '疑是地上霜', user: '疑是地下霜',
    result: 'TYPO', similarity: 0.8, message: '错别字（第4字「上」→「下」 不一样）',
  },
  {
    name: '错别字 TYPO（末字）', correct: '春眠不觉晓', user: '春眠不觉跳',
    result: 'TYPO', similarity: 0.8, message: '错别字（第5字「晓」→「跳」 不一样）',
  },
  {
    name: '超阈值 INCORRECT', correct: '春眠不觉晓', user: '夏雨落无声',
    result: 'INCORRECT', similarity: 0, message: '不正确（期望「春眠不觉晓」，你写的是「夏雨落无声」）',
  },
  {
    name: '小数点保留（3.14 vs 314）', correct: '3.14', user: '314',
    result: 'MISSING', similarity: 0.75, message: '少字（多「3」；缺「3.」）（缺 1 个字）',
  },
  {
    name: '小数点在数字间保留（3.14 vs 3,14）', correct: '3.14', user: '3,14',
    result: 'MISSING', similarity: 0.75, message: '少字（多「3」；缺「3.」）（缺 1 个字）',
  },
];

test('check：逐样例校验 result / similarity / message', () => {
  for (const c of CHECK_CASES) {
    const d = AnswerChecker.check(c.correct, c.user);
    assert.equal(d.result, c.result, `[${c.name}] result`);
    close(d.similarity, c.similarity, `[${c.name}] similarity`);
    assert.equal(d.message, c.message, `[${c.name}] message`);
    assert.equal(d.correctAnswer, c.correct.trim(), `[${c.name}] correctAnswer`);
    assert.equal(d.userAnswer, c.user.trim(), `[${c.name}] userAnswer`);
  }
});

test('check：AnswerChecker.check 与具名导出一致', () => {
  assert.deepEqual(check('春眠不觉晓', ''), AnswerChecker.check('春眠不觉晓', ''));
});

// ── checkDictation ───────────────────────────────────────────────────────
const ORIGINAL = ['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。'];

function assertDictation(actual: DictationCheckResult, exp: {
  coverageRate: number; accuracyRate: number; orderCorrectRate: number; overallScore: number;
}): void {
  close(actual.coverageRate, exp.coverageRate, 'coverageRate');
  close(actual.accuracyRate, exp.accuracyRate, 'accuracyRate');
  close(actual.orderCorrectRate, exp.orderCorrectRate, 'orderCorrectRate');
  close(actual.overallScore, exp.overallScore, 'overallScore');
}

test('checkDictation：全覆盖且顺序正确 → overall 1', () => {
  const r = checkDictation(ORIGINAL, '床前明月光，疑是地上霜。举头望明月，低头思故乡。');
  assert.equal(r.sentences.length, 4);
  r.sentences.forEach((s, i) => {
    assert.equal(s.result, 'CORRECT');
    assert.equal(s.matchIndex, i);
    close(s.similarity, 1);
    assert.equal(s.matchedOriginal, ORIGINAL[i]);
  });
  assertDictation(r, { coverageRate: 1, accuracyRate: 1, orderCorrectRate: 1, overallScore: 1 });
});

test('checkDictation：部分作答 → 覆盖率拉低总评（0.8）', () => {
  const r = checkDictation(ORIGINAL, '床前明月光，疑是地上霜。');
  assert.equal(r.sentences.length, 2);
  assert.deepEqual(r.sentences.map((s) => s.matchIndex), [0, 1]);
  assert.deepEqual(r.sentences.map((s) => s.result), ['CORRECT', 'CORRECT']);
  assertDictation(r, { coverageRate: 0.5, accuracyRate: 1, orderCorrectRate: 1, overallScore: 0.8 });
});

test('checkDictation：顺序错乱 → orderCorrectRate 0.75、总评 0.95', () => {
  const r = checkDictation(ORIGINAL, '疑是地上霜。床前明月光。举头望明月。低头思故乡。');
  assert.deepEqual(r.sentences.map((s) => s.matchIndex), [1, 0, 2, 3]);
  assert.deepEqual(r.sentences.map((s) => s.result), ['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT']);
  assertDictation(r, { coverageRate: 1, accuracyRate: 1, orderCorrectRate: 0.75, overallScore: 0.95 });
});

test('checkDictation：标点缺失导致首句并入 → 覆盖度与准确率下降', () => {
  // 首句漏了「，」，与第二句粘连为一句，长度预筛使其只能低分匹配到原文第 1 句
  const r = checkDictation(ORIGINAL, '床前明月光疑是地上霜。举头望明月。低头思故乡。');
  assert.equal(r.sentences.length, 3);
  assert.equal(r.sentences[0].result, 'INCORRECT');
  assert.equal(r.sentences[0].matchIndex, 0);
  close(r.sentences[0].similarity, 0.5);
  assert.deepEqual(r.sentences.slice(1).map((s) => s.matchIndex), [2, 3]);
  assertDictation(r, { coverageRate: 0.75, accuracyRate: 5 / 6, orderCorrectRate: 1, overallScore: 5 / 6 });
});

test('checkDictation：单句错别字 → TYPO（相似度 0.8）、总评 0.98', () => {
  const r = checkDictation(ORIGINAL, '床前明月光。疑是地下霜。举头望明月。低头思故乡。');
  assert.deepEqual(r.sentences.map((s) => s.result), ['CORRECT', 'TYPO', 'CORRECT', 'CORRECT']);
  close(r.sentences[1].similarity, 0.8);
  assertDictation(r, { coverageRate: 1, accuracyRate: 0.95, orderCorrectRate: 1, overallScore: 0.98 });
});

test('checkDictation：完全无标点 → 单块无法匹配（overall 0）', () => {
  const r = checkDictation(ORIGINAL, '床前明月光疑是地上霜举头望明月低头思故乡');
  assert.equal(r.sentences.length, 1);
  assert.equal(r.sentences[0].matchIndex, -1);
  assert.equal(r.sentences[0].matchedOriginal, null);
  assert.equal(r.sentences[0].result, 'INCORRECT');
  close(r.sentences[0].similarity, 0);
  assertDictation(r, { coverageRate: 0, accuracyRate: 0, orderCorrectRate: 0, overallScore: 0 });
});

test('checkDictation：原文为空 → 全 0、无分句', () => {
  const r = checkDictation([], '床前明月光');
  assert.deepEqual(r.sentences, []);
  assertDictation(r, { coverageRate: 0, accuracyRate: 0, orderCorrectRate: 0, overallScore: 0 });
});