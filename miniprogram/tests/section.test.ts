// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// SectionSplitter 测试
// 期望值由 Python 独立复刻同一规则交叉推导得到（含 U+3000 缩进 trim 口径）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { SectionSplitter, type Section, type RankedSection } from '../core/algorithms/section';

const IDEO = '\u3000\u3000'; // 两个全角空格（首行缩进）

test('split：空/全空白输入返回空数组', () => {
  assert.deepEqual(SectionSplitter.split(''), []);
  assert.deepEqual(SectionSplitter.split('   \n  '), []);
});

test('split：双空行硬分割（minSectionChars=1 不合并）', () => {
  const sections = SectionSplitter.split('第一段。\n\n第二段。', 1);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].index, 0);
  assert.equal(sections[0].heading, null);
  assert.equal(sections[0].text, '第一段。');
  assert.equal(sections[0].contentOnly, '第一段。');
  assert.equal(sections[0].startChar, 0);
  assert.equal(sections[0].endChar, 4);
  assert.equal(sections[0].sentenceCount, 1);
  assert.equal(sections[0].startSentenceIndex, 0);
  assert.equal(sections[1].index, 1);
  assert.equal(sections[1].startChar, 6);
  assert.equal(sections[1].endChar, 10);
  assert.equal(sections[1].startSentenceIndex, 1);
});

test('split：标题行识别（编号标题 + 正文）', () => {
  const sections = SectionSplitter.split('第一章 起源\n这是正文内容。\n\n第二段正文。', 1);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, '第一章 起源');
  assert.equal(sections[0].text, '第一章 起源\n这是正文内容。');
  assert.equal(sections[0].contentOnly, '这是正文内容。');
  assert.equal(sections[0].startChar, 0);
  assert.equal(sections[0].endChar, 14);
  assert.equal(sections[0].sentenceCount, 1);
  assert.equal(sections[1].heading, null);
  assert.equal(sections[1].contentOnly, '第二段正文。');
  assert.equal(sections[1].startChar, 16);
  assert.equal(sections[1].endChar, 22);
});

test('split：单行标题（无正文）heading 为 null，标题即内容', () => {
  const sections = SectionSplitter.split('第一章 起源\n正文内容在此。\n\n单独标题', 1);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, '第一章 起源');
  assert.equal(sections[0].contentOnly, '正文内容在此。');
  assert.equal(sections[1].heading, null);
  assert.equal(sections[1].text, '单独标题');
  assert.equal(sections[1].contentOnly, '单独标题');
  assert.equal(sections[1].startChar, 16);
  assert.equal(sections[1].endChar, 20);
});

test('split：过短段落合并到前一段（默认 minSectionChars=30）', () => {
  const sections = SectionSplitter.split('第一段正文。\n\n短。');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, null);
  assert.equal(sections[0].text, '第一段正文。\n短。');
  assert.equal(sections[0].contentOnly, '第一段正文。\n短。');
  assert.equal(sections[0].startChar, 0);
  assert.equal(sections[0].endChar, 10);
  assert.equal(sections[0].sentenceCount, 2);
  assert.equal(sections[0].startSentenceIndex, 0);
});

test('split：前一段有标题时不合并短段', () => {
  const sections = SectionSplitter.split('标题一\n正文。\n\n短。', 30);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, '标题一');
  assert.equal(sections[0].contentOnly, '正文。');
  assert.equal(sections[1].heading, null);
  assert.equal(sections[1].contentOnly, '短。');
  assert.equal(sections[1].startChar, 9);
  assert.equal(sections[1].endChar, 11);
});

test('split：无空行时按「句末标点 + 换行 + 缩进」分段（长度 > 100）', () => {
  const a1 =
    '第一段的内容需要写得足够长以保证整段文本的字符数超过一百个从而真正进入缩进分支的判定逻辑这里再补充一些文字凑数。';
  const a2 =
    '第二段的内容也需要写得足够长以保证整段文本的字符数超过一百个从而能够被正确切分为两个独立的段落再多写一些字。';
  const text = IDEO + a1 + '\n' + IDEO + a2;
  assert.ok(text.length > 100);

  const sections = SectionSplitter.split(text, 1);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].contentOnly, a1);
  assert.equal(sections[0].startChar, 2); // 跳过首行缩进
  assert.equal(sections[0].endChar, 2 + a1.length);
  assert.equal(sections[0].sentenceCount, 1);
  assert.equal(sections[0].startSentenceIndex, 0);
  assert.equal(sections[1].contentOnly, a2);
  assert.equal(sections[1].startChar, 2 + a1.length + 1 + 2);
  assert.equal(sections[1].endChar, text.length);
  assert.equal(sections[1].startSentenceIndex, 1);
});

test('split：缩进回退（行尾非句末标点）按缩进行切分', () => {
  const g1 =
    '第一行内容写得长一点用来凑足总字符数超过一百个字的门槛否则不会进入缩进分支的处理逻辑所以要写多一些字，';
  const g2 =
    '第二行内容同样需要写长一点凑够一百个字符的门槛这样整个文本长度才会超过一百并且触发回退逻辑，';
  const g3 = '第三行没有缩进。';
  const text = IDEO + g1 + '\n' + IDEO + g2 + '\n' + g3;
  assert.ok(text.length > 100);

  const sections = SectionSplitter.split(text, 1);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].contentOnly, g1);
  assert.equal(sections[0].startChar, 2);
  assert.equal(sections[0].endChar, 2 + g1.length);
  // 第二段把「第二个缩进行 + 后续非缩进行」并在一起
  assert.equal(sections[1].contentOnly, g2 + '\n' + g3);
  assert.equal(sections[1].startChar, 2 + g1.length + 1 + 2);
  assert.equal(sections[1].endChar, text.length);
  assert.equal(sections[1].sentenceCount, 2);
});

test('rankByErrorRate：按 startSentenceIndex 对齐全局句索引并倒序排列', () => {
  const text = '甲段第一句。甲段第二句。\n\n乙段第一句。乙段第二句。乙段第三句。';
  const sections: Section[] = SectionSplitter.split(text, 1);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].sentenceCount, 2);
  assert.equal(sections[1].sentenceCount, 3);
  assert.equal(sections[1].startSentenceIndex, 2);

  const rates: Record<number, number> = { 0: 1.0, 1: 0.0, 2: 0.5, 3: 0.5, 4: 0.0 };
  const ranked: RankedSection[] = SectionSplitter.rankByErrorRate(sections, rates);
  assert.equal(ranked.length, 2);
  // 段0：句 0,1 → (1.0+0.0)/2 = 0.5
  assert.equal(ranked[0].section.index, 0);
  assert.equal(ranked[0].errorRate, 0.5);
  // 段1：句 2,3,4 → (0.5+0.5+0.0)/3 = 1/3（证明使用全局句索引对齐）
  assert.equal(ranked[1].section.index, 1);
  assert.ok(Math.abs(ranked[1].errorRate - 1 / 3) < 1e-9);
});

test('rankByErrorRate：无匹配错误率时均为 0 且保持稳定顺序', () => {
  const text = '甲段第一句。甲段第二句。\n\n乙段第一句。乙段第二句。';
  const sections = SectionSplitter.split(text, 1);
  const ranked = SectionSplitter.rankByErrorRate(sections, {});
  assert.deepEqual(
    ranked.map((r) => r.section.index),
    [0, 1]
  );
  assert.equal(ranked[0].errorRate, 0);
  assert.equal(ranked[1].errorRate, 0);
});