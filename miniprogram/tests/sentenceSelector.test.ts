import test from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSelector } from '../core/algorithms/sentenceSelector';
import type { Rng } from '../core/algorithms/sentenceSelector';
import { SENTENCE_KEY_PREFIX } from '../core/algorithms/types';
import type { ArticleEntity } from '../core/algorithms/types';
import type { CardState } from '../core/algorithms/fsrs';

function article(uuid: string, content: string): ArticleEntity {
  return { uuid, title: `标题-${uuid}`, content, author: '', autoIndent: false, createdAt: 0, updatedAt: 0 };
}
function cstate(over: Partial<CardState> = {}): CardState {
  return { difficulty: 5, stability: 1, due: 0, lastReview: 0, reviewCount: 1, lapses: 0, lastRating: 3, ...over };
}
/** 确定性随机源：nextInt 恒返回 0（对应 Kotlin 注入固定 Rank 的 Random） */
const zeroRng: Rng = { nextInt: () => 0 };

const A = article('A', '这是A的第一句内容。这是A的第二句内容。');
const B = article('B', '这是B的第一句内容。这是B的第二句内容。');
const C = article('C', '这是C的第一句内容。这是C的第二句内容。');
const D = article('D', '这是D的第一句内容。这是D的第二句内容。');

test('SENTENCE_KEY_PREFIX 与 sentenceKey（与 Python hashlib 交叉验证）', () => {
  assert.equal(SENTENCE_KEY_PREFIX, 's:');
  assert.equal(SentenceSelector.SENTENCE_KEY_PREFIX, 's:');
  // 期望值：s:<uuid>:<sha256(trim(text)) 前 8 字节 hex>
  assert.equal(SentenceSelector.sentenceKey('ART_UUID', '床前明月光，疑是地上霜。'), 's:ART_UUID:0c9b923743153534');
  assert.equal(SentenceSelector.sentenceKey('ART_UUID', 'Hello world!'), 's:ART_UUID:c0535e4be2b79ffd');
  assert.equal(SentenceSelector.sentenceKey('ART_UUID', '多情自古伤离别，更那堪，冷落清秋节！'), 's:ART_UUID:ccb663e383a191e8');
  // hash16 先 trim
  assert.equal(SentenceSelector.sentenceKey('ART_UUID', '  abc  '), 's:ART_UUID:ba7816bf8f01cfea');
  assert.equal(SentenceSelector.sentenceKey('ART_UUID', '  abc  '), SentenceSelector.sentenceKey('ART_UUID', 'abc'));
});

test('articleIdOf：脏键返回 null', () => {
  assert.equal(SentenceSelector.articleIdOf('s:ART:deadbeef'), 'ART');
  assert.equal(SentenceSelector.articleIdOf('nope'), null);
  assert.equal(SentenceSelector.articleIdOf('s:ART'), null);
  assert.equal(SentenceSelector.articleIdOf('s:ART:'), null);
  assert.equal(SentenceSelector.articleIdOf('s::deadbeef'), null);
});

test('isEligible：长度 6..80 与至少 2 个汉字/字母', () => {
  assert.equal(SentenceSelector.isEligible('abcde'), false, '5 字符');
  assert.equal(SentenceSelector.isEligible('abcdef'), true, '6 字符');
  assert.equal(SentenceSelector.isEligible('  abcdef  '), true, 'trim 后 6 字符');
  assert.equal(SentenceSelector.isEligible('a'.repeat(80)), true, '80 字符');
  assert.equal(SentenceSelector.isEligible('a'.repeat(81)), false, '81 字符');
  // 内容字符数
  assert.equal(SentenceSelector.isEligible('......'), false, '纯标点');
  assert.equal(SentenceSelector.isEligible('a.....'), false, '仅 1 个字母');
  assert.equal(SentenceSelector.isEligible('ab....'), true, '2 个字母');
  assert.equal(SentenceSelector.isEligible('你好世界啊'), false, '5 个汉字');
  assert.equal(SentenceSelector.isEligible('你好世界啊啊'), true, '6 个汉字');
  assert.equal(SentenceSelector.isEligible('你好，。！？'), true, '长度 6 且恰好 2 个内容字符');
  assert.equal(SentenceSelector.isEligible('a！！？？？'), false, '长度 6 但仅 1 个内容字符');
});

test('candidates：切句 + 合格过滤 + 同文本去重（保留首处位置）', () => {
  const art = article('X', '这是X的第一句内容。这是X的第二句内容。这是X的第一句内容。短。');
  const cands = SentenceSelector.candidates(art);
  assert.equal(cands.length, 2, '第三句与第一句同文本 → 去重');
  assert.deepEqual(cands.map((c) => c.text), ['这是X的第一句内容。', '这是X的第二句内容。']);
  assert.deepEqual(cands.map((c) => [c.start, c.end]), [[0, 10], [10, 20]]);
  assert.equal(cands[0].start, 0);
  assert.equal(cands[0].key, SentenceSelector.sentenceKey('X', '这是X的第一句内容。'));
  assert.ok(cands.every((c) => c.articleId === 'X'));
});

test('pickDue：仅句子键且已到期，取 due 最小者', () => {
  const states = new Map<string, CardState>([
    ['article:A', cstate({ due: 100 })],              // 非句子键 → 忽略
    ['s:A:aaa', cstate({ due: 1000 })],
    ['s:B:bbb', cstate({ due: 500 })],
    ['s:C:ccc', cstate({ due: 200, reviewCount: 0 })], // 未开始 → 不 due
    ['s:D:ddd', cstate({ due: 10000 })],               // 未到期
  ]);
  assert.equal(SentenceSelector.pickDue(states, 2000), 's:B:bbb');
  assert.equal(SentenceSelector.pickDue(new Map(), 2000), null);
});

test('lastReviewByArticle：按文章取最近一次句级复习时间', () => {
  const states = new Map<string, CardState>([
    ['s:A:x', cstate({ lastReview: 100 })],
    ['s:A:y', cstate({ lastReview: 300 })],
    ['s:B:z', cstate({ lastReview: 200 })],
    ['article:A', cstate({ lastReview: 999 })], // 非句子键 → 忽略
  ]);
  const m = SentenceSelector.lastReviewByArticle(states);
  assert.deepEqual([...m.entries()].sort(), [['A', 300], ['B', 200]]);
  assert.deepEqual([...SentenceSelector.lastReviewByArticle(new Map()).entries()], []);
});

test('pickNew：优先最久未抽过句子的文章（已抽过的文章靠后）', () => {
  // A 最近抽过 → lastReview 大 → 排序最末
  const states = new Map<string, CardState>([
    [SentenceSelector.sentenceKey('A', '这是A的第一句内容。'), cstate({ lastReview: 9999 })],
  ]);
  // ordered = [B,C,D,A]；head = shuffle([B,C,D]) + [A] = [C,D,B,A]
  const pick = SentenceSelector.pickNew([A, B, C, D], states, zeroRng)!;
  assert.equal(pick.articleId, 'C');
  assert.equal(pick.text, '这是C的第一句内容。');
  assert.equal(pick.key, SentenceSelector.sentenceKey('C', '这是C的第一句内容。'));
});

test('pickNew：已有状态的句子不再作为新句（跳到下一篇）', () => {
  const states = new Map<string, CardState>([
    [SentenceSelector.sentenceKey('A', '这是A的第一句内容。'), cstate({ lastReview: 9999 })],
    // C 的两句都抽过
    [SentenceSelector.sentenceKey('C', '这是C的第一句内容。'), cstate({ lastReview: 10 })],
    [SentenceSelector.sentenceKey('C', '这是C的第二句内容。'), cstate({ lastReview: 20 })],
  ]);
  const pick = SentenceSelector.pickNew([A, B, C, D], states, zeroRng)!;
  assert.equal(pick.articleId, 'D', 'C 已全抽过 → 取 D 的新句');
  assert.equal(pick.text, '这是D的第一句内容。');
});

test('pickNew：全库都抽过 → 兜底取 lastReview 最早的句子', () => {
  const states = new Map<string, CardState>();
  const set = (uuid: string, sentences: string[], times: number[]) => {
    sentences.forEach((s, i) => states.set(SentenceSelector.sentenceKey(uuid, s), cstate({ lastReview: times[i] })));
  };
  set('A', ['这是A的第一句内容。', '这是A的第二句内容。'], [100, 200]);
  set('B', ['这是B的第一句内容。', '这是B的第二句内容。'], [50, 60]);
  set('C', ['这是C的第一句内容。', '这是C的第二句内容。'], [300, 400]);
  set('D', ['这是D的第一句内容。', '这是D的第二句内容。'], [500, 600]);

  const pick = SentenceSelector.pickNew([A, B, C, D], states, zeroRng)!;
  assert.equal(pick.key, SentenceSelector.sentenceKey('B', '这是B的第一句内容。'), '全局 lastReview 最早者');
});

test('pickNew：空文章 / 无合格句 / 无状态时的返回', () => {
  assert.equal(SentenceSelector.pickNew([], new Map(), zeroRng), null);
  const z = article('Z', '短。');
  assert.deepEqual(SentenceSelector.candidates(z), []);
  assert.equal(SentenceSelector.pickNew([z], new Map(), zeroRng), null);
});