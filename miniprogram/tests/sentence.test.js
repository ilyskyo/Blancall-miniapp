"use strict";
// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// SentenceSplitter 测试
// 期望值由 Python 独立复刻同一规则交叉推导得到。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sentence_1 = require("../core/algorithms/sentence");
(0, node_test_1.default)('split：中文句末标点', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('你好。世界！'), ['你好。', '世界！']);
});
(0, node_test_1.default)('split：英文句末标点', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('Hello world. How are you?'), [
        'Hello world.',
        'How are you?',
    ]);
});
(0, node_test_1.default)('split：英文缩写内部的句点不切分', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('Mr. Smith went home.'), ['Mr. Smith went home.']);
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('Dr. Lee and Mrs. Park arrived.'), [
        'Dr. Lee and Mrs. Park arrived.',
    ]);
    // U.S. token 内部句点不切分
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('I live in the U.S. today.'), [
        'I live in the U.S. today.',
    ]);
});
(0, node_test_1.default)('split：数字小数点不切分', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('Pi is 3.14 exactly.'), ['Pi is 3.14 exactly.']);
});
(0, node_test_1.default)('split：省略号只在最后一个 … 之后切分', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('他说……'), ['他说……']);
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('真的吗……好吧。'), ['真的吗……', '好吧。']);
});
(0, node_test_1.default)('split：右配对符号（引号）处统一切分', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('他说："你好！"然后走了。'), [
        '他说："你好！"',
        '然后走了。',
    ]);
    // 支持嵌套引号
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('他说："她说：『你好。』"然后走了。'), [
        '他说："她说：『你好。』"',
        '然后走了。',
    ]);
});
(0, node_test_1.default)('split：treatNewlineAsSentence 两种取值', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('第一行\n第二行', true), ['第一行', '第二行']);
    // 软换行模式：单换行不切分
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('第一行\n第二行', false), ['第一行\n第二行']);
    // 默认值为 true
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split('第一行\n第二行'), ['第一行', '第二行']);
});
(0, node_test_1.default)('splitWithPositions：位置（UTF-16 code unit，endIndex exclusive）正确', () => {
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.splitWithPositions('你好。世界！'), [
        { text: '你好。', startIndex: 0, endIndex: 3 },
        { text: '世界！', startIndex: 3, endIndex: 6 },
    ]);
    // 句间空白会被跳过，故第二句 startIndex = 4
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.splitWithPositions('你好。 世界！'), [
        { text: '你好。', startIndex: 0, endIndex: 3 },
        { text: '世界！', startIndex: 4, endIndex: 7 },
    ]);
    // 开头空白会被跳过
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.splitWithPositions('  你好。'), [
        { text: '你好。', startIndex: 2, endIndex: 5 },
    ]);
});
(0, node_test_1.default)('splitWithPositions：切片可还原句子（去除首尾空白）', () => {
    const text = '你好。 世界！';
    for (const s of sentence_1.SentenceSplitter.splitWithPositions(text)) {
        strict_1.default.equal(text.slice(s.startIndex, s.endIndex).trim(), s.text);
    }
});
