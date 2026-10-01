// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// SentenceSplitter 测试
// 期望值由 Python 独立复刻同一规则交叉推导得到。

import test from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSplitter } from '../core/algorithms/sentence';

test('split：中文句末标点', () => {
  assert.deepEqual(SentenceSplitter.split('你好。世界！'), ['你好。', '世界！']);
});

test('split：英文句末标点', () => {
  assert.deepEqual(SentenceSplitter.split('Hello world. How are you?'), [
    'Hello world.',
    'How are you?',
  ]);
});

test('split：英文缩写内部的句点不切分', () => {
  assert.deepEqual(SentenceSplitter.split('Mr. Smith went home.'), ['Mr. Smith went home.']);
  assert.deepEqual(SentenceSplitter.split('Dr. Lee and Mrs. Park arrived.'), [
    'Dr. Lee and Mrs. Park arrived.',
  ]);
  // U.S. token 内部句点不切分
  assert.deepEqual(SentenceSplitter.split('I live in the U.S. today.'), [
    'I live in the U.S. today.',
  ]);
});

test('split：数字小数点不切分', () => {
  assert.deepEqual(SentenceSplitter.split('Pi is 3.14 exactly.'), ['Pi is 3.14 exactly.']);
});

test('split：省略号只在最后一个 … 之后切分', () => {
  assert.deepEqual(SentenceSplitter.split('他说……'), ['他说……']);
  assert.deepEqual(SentenceSplitter.split('真的吗……好吧。'), ['真的吗……', '好吧。']);
});

test('split：右配对符号（引号）处统一切分', () => {
  assert.deepEqual(SentenceSplitter.split('他说："你好！"然后走了。'), [
    '他说："你好！"',
    '然后走了。',
  ]);
  // 支持嵌套引号
  assert.deepEqual(SentenceSplitter.split('他说："她说：『你好。』"然后走了。'), [
    '他说："她说：『你好。』"',
    '然后走了。',
  ]);
});

test('split：treatNewlineAsSentence 两种取值', () => {
  assert.deepEqual(SentenceSplitter.split('第一行\n第二行', true), ['第一行', '第二行']);
  // 软换行模式：单换行不切分
  assert.deepEqual(SentenceSplitter.split('第一行\n第二行', false), ['第一行\n第二行']);
  // 默认值为 true
  assert.deepEqual(SentenceSplitter.split('第一行\n第二行'), ['第一行', '第二行']);
});

test('splitWithPositions：位置（UTF-16 code unit，endIndex exclusive）正确', () => {
  assert.deepEqual(SentenceSplitter.splitWithPositions('你好。世界！'), [
    { text: '你好。', startIndex: 0, endIndex: 3 },
    { text: '世界！', startIndex: 3, endIndex: 6 },
  ]);
  // 句间空白会被跳过，故第二句 startIndex = 4
  assert.deepEqual(SentenceSplitter.splitWithPositions('你好。 世界！'), [
    { text: '你好。', startIndex: 0, endIndex: 3 },
    { text: '世界！', startIndex: 4, endIndex: 7 },
  ]);
  // 开头空白会被跳过
  assert.deepEqual(SentenceSplitter.splitWithPositions('  你好。'), [
    { text: '你好。', startIndex: 2, endIndex: 5 },
  ]);
});

test('splitWithPositions：切片可还原句子（去除首尾空白）', () => {
  const text = '你好。 世界！';
  for (const s of SentenceSplitter.splitWithPositions(text)) {
    assert.equal(text.slice(s.startIndex, s.endIndex).trim(), s.text);
  }
});