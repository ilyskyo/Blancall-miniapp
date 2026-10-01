import test from 'node:test';
import assert from 'node:assert/strict';
import { DictationScorer, score } from '../core/algorithms/dictation';

// 期望值由 Python 独立复刻 DictationScorer.kt（含 TextNormalizer/SentenceSplitter）生成；
// 固定样例，相似度允许 ±1e-6 误差（Kotlin Float ↔ TS number 精度差）。
const EPS = 1e-6;
function close(actual: number, expected: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= EPS,
    `${msg ?? ''} 期望 ${expected}，实际 ${actual}`,
  );
}

test('score：空 / 空白输入边界', () => {
  assert.equal(score('', ''), 1);        // 双方都空 → 1
  assert.equal(score('   ', '  '), 1);   // 双方都空白 → 1
  assert.equal(score('', '床前明月光'), 0); // 原文空 → 0
  assert.equal(score('床前明月光', ''), 0); // 作答空 → 0
});

test('score：完全相同 → 1', () => {
  close(score('床前明月光，疑是地上霜。', '床前明月光，疑是地上霜。'), 1);
  close(score('Hello 世界。', 'Hello 世界。'), 1);
});

test('score：中英文混排（英文大小写敏感）', () => {
  // TextNormalizer 不做大小写折叠：仅首字母大小写不同 → charSim = 1 - 1/8 = 0.875
  close(score('Hello 世界。', 'hello 世界。'), 0.875);
  // 末尾多一句：charSim = 2/3，分句通道整句命中 = 1 → 0.7*(2/3)+0.3 = 23/30
  close(score('床前明月光，疑是地上霜。', '床前明月光，疑是地上霜。举头望明月。'), 23 / 30);
  close(score('Hello World', 'Hello'), 0.5);
});

test('score：中文数字 vs 阿拉伯数字（单字等值，多字受「十」未映射限制）', () => {
  // 「三」→「3」完全等值
  close(score('三', '3'), 1);
  // 「三十」→「3十」，「30」→「30」：仅 1 处不同（2 长）→ 0.5（「十」不在数字映射表中，忠实于 Kotlin）
  close(score('三十', '30'), 0.5);
});

test('score：繁简等价', () => {
  close(score('說話', '说话'), 1);
});

test('score：单字差异 / 换位感知（Damerau-Levenshtein）', () => {
  // 一处替换：maxLen 12 → 1 - 1/12 = 11/12
  close(score('床前明月光，疑是地上霜。', '床前明月光，疑是地下霜。'), 11 / 12);
  // 相邻换位按 1 次计：1 - 1/3 = 2/3
  close(score('ABC', 'ACB'), 2 / 3);
  // 英文换位：归一化去空格后 17 长 → 1 - 1/17
  close(score('The quick brown fox.', 'The quikc brown fox.'), 1 - 1 / 17);
  // 分句内次序调换：charSim 1-1/12，分句通道 0.5 → 0.7*(11/12)+0.3*0.5 = 19/24
  close(score('床前明月光，疑是地上霜。', '床前明月光。疑是地上霜。'), 19 / 24);
});

test('score：超长截断（>20000 字符，MAX_INPUT_LENGTH = 20000）', () => {
  // 尾部内容被推到第 20000 字符之后 → 截断后与「x」等价，得分 1
  const longWithTail = 'x' + ' '.repeat(20000) + 'x'.repeat(10);
  assert.ok(longWithTail.length > 20000, '构造样例必须超过 20000 字符');
  close(score(longWithTail, 'x'), 1);

  // 对照组：同样的尾缀若落在 20000 之内（即未截断）→ 长度差超出带状阈值，得分 0
  close(score('x'.repeat(11), 'x'), 0);

  // 中文超长截断
  const longCn = '春' + '　'.repeat(20000) + '眠不觉晓';
  assert.ok(longCn.length > 20000, '构造样例必须超过 20000 字符');
  close(score(longCn, '春'), 1);
});

test('score：DictationScorer.score 与具名导出一致', () => {
  assert.equal(DictationScorer.score('春眠不觉晓', '春眠不觉晓'), score('春眠不觉晓', '春眠不觉晓'));
});