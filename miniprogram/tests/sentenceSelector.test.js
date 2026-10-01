"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sentenceSelector_1 = require("../core/algorithms/sentenceSelector");
const types_1 = require("../core/algorithms/types");
function article(uuid, content) {
    return { uuid, title: `标题-${uuid}`, content, author: '', autoIndent: false, createdAt: 0, updatedAt: 0 };
}
function cstate(over = {}) {
    return { difficulty: 5, stability: 1, due: 0, lastReview: 0, reviewCount: 1, lapses: 0, lastRating: 3, ...over };
}
/** 确定性随机源：nextInt 恒返回 0（对应 Kotlin 注入固定 Rank 的 Random） */
const zeroRng = { nextInt: () => 0 };
const A = article('A', '这是A的第一句内容。这是A的第二句内容。');
const B = article('B', '这是B的第一句内容。这是B的第二句内容。');
const C = article('C', '这是C的第一句内容。这是C的第二句内容。');
const D = article('D', '这是D的第一句内容。这是D的第二句内容。');
(0, node_test_1.default)('SENTENCE_KEY_PREFIX 与 sentenceKey（与 Python hashlib 交叉验证）', () => {
    strict_1.default.equal(types_1.SENTENCE_KEY_PREFIX, 's:');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.SENTENCE_KEY_PREFIX, 's:');
    // 期望值：s:<uuid>:<sha256(trim(text)) 前 8 字节 hex>
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.sentenceKey('ART_UUID', '床前明月光，疑是地上霜。'), 's:ART_UUID:0c9b923743153534');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.sentenceKey('ART_UUID', 'Hello world!'), 's:ART_UUID:c0535e4be2b79ffd');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.sentenceKey('ART_UUID', '多情自古伤离别，更那堪，冷落清秋节！'), 's:ART_UUID:ccb663e383a191e8');
    // hash16 先 trim
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.sentenceKey('ART_UUID', '  abc  '), 's:ART_UUID:ba7816bf8f01cfea');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.sentenceKey('ART_UUID', '  abc  '), sentenceSelector_1.SentenceSelector.sentenceKey('ART_UUID', 'abc'));
});
(0, node_test_1.default)('articleIdOf：脏键返回 null', () => {
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.articleIdOf('s:ART:deadbeef'), 'ART');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.articleIdOf('nope'), null);
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.articleIdOf('s:ART'), null);
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.articleIdOf('s:ART:'), null);
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.articleIdOf('s::deadbeef'), null);
});
(0, node_test_1.default)('isEligible：长度 6..80 与至少 2 个汉字/字母', () => {
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('abcde'), false, '5 字符');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('abcdef'), true, '6 字符');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('  abcdef  '), true, 'trim 后 6 字符');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('a'.repeat(80)), true, '80 字符');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('a'.repeat(81)), false, '81 字符');
    // 内容字符数
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('......'), false, '纯标点');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('a.....'), false, '仅 1 个字母');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('ab....'), true, '2 个字母');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('你好世界啊'), false, '5 个汉字');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('你好世界啊啊'), true, '6 个汉字');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('你好，。！？'), true, '长度 6 且恰好 2 个内容字符');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.isEligible('a！！？？？'), false, '长度 6 但仅 1 个内容字符');
});
(0, node_test_1.default)('candidates：切句 + 合格过滤 + 同文本去重（保留首处位置）', () => {
    const art = article('X', '这是X的第一句内容。这是X的第二句内容。这是X的第一句内容。短。');
    const cands = sentenceSelector_1.SentenceSelector.candidates(art);
    strict_1.default.equal(cands.length, 2, '第三句与第一句同文本 → 去重');
    strict_1.default.deepEqual(cands.map((c) => c.text), ['这是X的第一句内容。', '这是X的第二句内容。']);
    strict_1.default.deepEqual(cands.map((c) => [c.start, c.end]), [[0, 10], [10, 20]]);
    strict_1.default.equal(cands[0].start, 0);
    strict_1.default.equal(cands[0].key, sentenceSelector_1.SentenceSelector.sentenceKey('X', '这是X的第一句内容。'));
    strict_1.default.ok(cands.every((c) => c.articleId === 'X'));
});
(0, node_test_1.default)('pickDue：仅句子键且已到期，取 due 最小者', () => {
    const states = new Map([
        ['article:A', cstate({ due: 100 })], // 非句子键 → 忽略
        ['s:A:aaa', cstate({ due: 1000 })],
        ['s:B:bbb', cstate({ due: 500 })],
        ['s:C:ccc', cstate({ due: 200, reviewCount: 0 })], // 未开始 → 不 due
        ['s:D:ddd', cstate({ due: 10000 })], // 未到期
    ]);
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.pickDue(states, 2000), 's:B:bbb');
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.pickDue(new Map(), 2000), null);
});
(0, node_test_1.default)('lastReviewByArticle：按文章取最近一次句级复习时间', () => {
    const states = new Map([
        ['s:A:x', cstate({ lastReview: 100 })],
        ['s:A:y', cstate({ lastReview: 300 })],
        ['s:B:z', cstate({ lastReview: 200 })],
        ['article:A', cstate({ lastReview: 999 })], // 非句子键 → 忽略
    ]);
    const m = sentenceSelector_1.SentenceSelector.lastReviewByArticle(states);
    strict_1.default.deepEqual([...m.entries()].sort(), [['A', 300], ['B', 200]]);
    strict_1.default.deepEqual([...sentenceSelector_1.SentenceSelector.lastReviewByArticle(new Map()).entries()], []);
});
(0, node_test_1.default)('pickNew：优先最久未抽过句子的文章（已抽过的文章靠后）', () => {
    // A 最近抽过 → lastReview 大 → 排序最末
    const states = new Map([
        [sentenceSelector_1.SentenceSelector.sentenceKey('A', '这是A的第一句内容。'), cstate({ lastReview: 9999 })],
    ]);
    // ordered = [B,C,D,A]；head = shuffle([B,C,D]) + [A] = [C,D,B,A]
    const pick = sentenceSelector_1.SentenceSelector.pickNew([A, B, C, D], states, zeroRng);
    strict_1.default.equal(pick.articleId, 'C');
    strict_1.default.equal(pick.text, '这是C的第一句内容。');
    strict_1.default.equal(pick.key, sentenceSelector_1.SentenceSelector.sentenceKey('C', '这是C的第一句内容。'));
});
(0, node_test_1.default)('pickNew：已有状态的句子不再作为新句（跳到下一篇）', () => {
    const states = new Map([
        [sentenceSelector_1.SentenceSelector.sentenceKey('A', '这是A的第一句内容。'), cstate({ lastReview: 9999 })],
        // C 的两句都抽过
        [sentenceSelector_1.SentenceSelector.sentenceKey('C', '这是C的第一句内容。'), cstate({ lastReview: 10 })],
        [sentenceSelector_1.SentenceSelector.sentenceKey('C', '这是C的第二句内容。'), cstate({ lastReview: 20 })],
    ]);
    const pick = sentenceSelector_1.SentenceSelector.pickNew([A, B, C, D], states, zeroRng);
    strict_1.default.equal(pick.articleId, 'D', 'C 已全抽过 → 取 D 的新句');
    strict_1.default.equal(pick.text, '这是D的第一句内容。');
});
(0, node_test_1.default)('pickNew：全库都抽过 → 兜底取 lastReview 最早的句子', () => {
    const states = new Map();
    const set = (uuid, sentences, times) => {
        sentences.forEach((s, i) => states.set(sentenceSelector_1.SentenceSelector.sentenceKey(uuid, s), cstate({ lastReview: times[i] })));
    };
    set('A', ['这是A的第一句内容。', '这是A的第二句内容。'], [100, 200]);
    set('B', ['这是B的第一句内容。', '这是B的第二句内容。'], [50, 60]);
    set('C', ['这是C的第一句内容。', '这是C的第二句内容。'], [300, 400]);
    set('D', ['这是D的第一句内容。', '这是D的第二句内容。'], [500, 600]);
    const pick = sentenceSelector_1.SentenceSelector.pickNew([A, B, C, D], states, zeroRng);
    strict_1.default.equal(pick.key, sentenceSelector_1.SentenceSelector.sentenceKey('B', '这是B的第一句内容。'), '全局 lastReview 最早者');
});
(0, node_test_1.default)('pickNew：空文章 / 无合格句 / 无状态时的返回', () => {
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.pickNew([], new Map(), zeroRng), null);
    const z = article('Z', '短。');
    strict_1.default.deepEqual(sentenceSelector_1.SentenceSelector.candidates(z), []);
    strict_1.default.equal(sentenceSelector_1.SentenceSelector.pickNew([z], new Map(), zeroRng), null);
});
