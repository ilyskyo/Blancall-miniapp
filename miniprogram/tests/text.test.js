"use strict";
// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// TextNormalizer / applyFirstLineIndent 测试
// 期望值由 Python 独立复刻同一规则（含 unicodedata NFKC）交叉推导得到。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const text_1 = require("../core/algorithms/text");
(0, node_test_1.default)('normalize：NFKC + 全角 ASCII→半角 + 删除全部空白', () => {
    // 全角字母/数字经 NFKC 折叠为半角
    strict_1.default.equal(text_1.TextNormalizer.normalize('ＡＢＣ１２３'), 'ABC123');
    // 全角标点 → 半角
    strict_1.default.equal(text_1.TextNormalizer.normalize('Full-Width！？'), 'Full-Width!?');
    // 表意空格 U+3000 被删除（属空白）
    strict_1.default.equal(text_1.TextNormalizer.normalize('你好\u3000世界'), '你好世界');
    // 空格/换行/制表符全部移除（中文默写空白不参与评分）
    strict_1.default.equal(text_1.TextNormalizer.normalize('  a b\nc\td '), 'abcd');
});
(0, node_test_1.default)('normalize：繁体→简体映射', () => {
    strict_1.default.equal(text_1.TextNormalizer.normalize('們說這'), '们说这');
    strict_1.default.equal(text_1.TextNormalizer.normalize('學習國'), '学习国');
});
(0, node_test_1.default)('normalize：中文数字→阿拉伯数字', () => {
    strict_1.default.equal(text_1.TextNormalizer.normalize('一二三'), '123');
    strict_1.default.equal(text_1.TextNormalizer.normalize('兩'), '2');
    strict_1.default.equal(text_1.TextNormalizer.normalize('〇'), '0');
    // 「兩」「两」均映射为 2
    strict_1.default.equal(text_1.TextNormalizer.normalize('两'), '2');
});
(0, node_test_1.default)('normalize：组合规则（NFKC + 繁简 + 数字 + 去空白）', () => {
    // 說 → 说；：→ :（NFKC）；１２３ → 123（NFKC）
    strict_1.default.equal(text_1.TextNormalizer.normalize('說：１２３'), '说:123');
});
(0, node_test_1.default)('normalizeList：逐条归一化', () => {
    strict_1.default.deepEqual(text_1.TextNormalizer.normalizeList(['們', '一二三', 'ＡＢ']), ['们', '123', 'AB']);
});
(0, node_test_1.default)('isLineIndented：任意空白开头即视为已缩进', () => {
    strict_1.default.equal((0, text_1.isLineIndented)('\u3000\u3000文本'), true);
    strict_1.default.equal((0, text_1.isLineIndented)('  文本'), true);
    strict_1.default.equal((0, text_1.isLineIndented)('\t文本'), true);
    strict_1.default.equal((0, text_1.isLineIndented)('文本'), false);
    strict_1.default.equal((0, text_1.isLineIndented)(''), false);
});
(0, node_test_1.default)('applyFirstLineIndent：按空行分段，仅缩进每段首行', () => {
    strict_1.default.equal((0, text_1.applyFirstLineIndent)('第一段\n第二段\n\n第三段'), '\u3000\u3000第一段\n第二段\n\n\u3000\u3000第三段');
    // 已缩进的段落原样保留
    strict_1.default.equal((0, text_1.applyFirstLineIndent)('\u3000\u3000已有缩进\n\n续段'), '\u3000\u3000已有缩进\n\n\u3000\u3000续段');
    strict_1.default.equal((0, text_1.applyFirstLineIndent)('甲\n\n乙'), '\u3000\u3000甲\n\n\u3000\u3000乙');
    strict_1.default.equal((0, text_1.applyFirstLineIndent)('第一段\n第二段'), '\u3000\u3000第一段\n第二段');
    strict_1.default.equal((0, text_1.applyFirstLineIndent)(''), '');
});
(0, node_test_1.default)('applyFirstLineIndent：幂等', () => {
    const src = '第一段\n第二段\n\n第三段';
    const once = (0, text_1.applyFirstLineIndent)(src);
    strict_1.default.equal((0, text_1.applyFirstLineIndent)(once), once);
});
