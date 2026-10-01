// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// TextNormalizer / applyFirstLineIndent 测试
// 期望值由 Python 独立复刻同一规则（含 unicodedata NFKC）交叉推导得到。

import test from 'node:test';
import assert from 'node:assert/strict';
import { TextNormalizer, applyFirstLineIndent, isLineIndented } from '../core/algorithms/text';

test('normalize：NFKC + 全角 ASCII→半角 + 删除全部空白', () => {
  // 全角字母/数字经 NFKC 折叠为半角
  assert.equal(TextNormalizer.normalize('ＡＢＣ１２３'), 'ABC123');
  // 全角标点 → 半角
  assert.equal(TextNormalizer.normalize('Full-Width！？'), 'Full-Width!?');
  // 表意空格 U+3000 被删除（属空白）
  assert.equal(TextNormalizer.normalize('你好\u3000世界'), '你好世界');
  // 空格/换行/制表符全部移除（中文默写空白不参与评分）
  assert.equal(TextNormalizer.normalize('  a b\nc\td '), 'abcd');
});

test('normalize：繁体→简体映射', () => {
  assert.equal(TextNormalizer.normalize('們說這'), '们说这');
  assert.equal(TextNormalizer.normalize('學習國'), '学习国');
});

test('normalize：中文数字→阿拉伯数字', () => {
  assert.equal(TextNormalizer.normalize('一二三'), '123');
  assert.equal(TextNormalizer.normalize('兩'), '2');
  assert.equal(TextNormalizer.normalize('〇'), '0');
  // 「兩」「两」均映射为 2
  assert.equal(TextNormalizer.normalize('两'), '2');
});

test('normalize：组合规则（NFKC + 繁简 + 数字 + 去空白）', () => {
  // 說 → 说；：→ :（NFKC）；１２３ → 123（NFKC）
  assert.equal(TextNormalizer.normalize('說：１２３'), '说:123');
});

test('normalizeList：逐条归一化', () => {
  assert.deepEqual(TextNormalizer.normalizeList(['們', '一二三', 'ＡＢ']), ['们', '123', 'AB']);
});

test('isLineIndented：任意空白开头即视为已缩进', () => {
  assert.equal(isLineIndented('\u3000\u3000文本'), true);
  assert.equal(isLineIndented('  文本'), true);
  assert.equal(isLineIndented('\t文本'), true);
  assert.equal(isLineIndented('文本'), false);
  assert.equal(isLineIndented(''), false);
});

test('applyFirstLineIndent：按空行分段，仅缩进每段首行', () => {
  assert.equal(
    applyFirstLineIndent('第一段\n第二段\n\n第三段'),
    '\u3000\u3000第一段\n第二段\n\n\u3000\u3000第三段'
  );
  // 已缩进的段落原样保留
  assert.equal(
    applyFirstLineIndent('\u3000\u3000已有缩进\n\n续段'),
    '\u3000\u3000已有缩进\n\n\u3000\u3000续段'
  );
  assert.equal(applyFirstLineIndent('甲\n\n乙'), '\u3000\u3000甲\n\n\u3000\u3000乙');
  assert.equal(applyFirstLineIndent('第一段\n第二段'), '\u3000\u3000第一段\n第二段');
  assert.equal(applyFirstLineIndent(''), '');
});

test('applyFirstLineIndent：幂等', () => {
  const src = '第一段\n第二段\n\n第三段';
  const once = applyFirstLineIndent(src);
  assert.equal(applyFirstLineIndent(once), once);
});