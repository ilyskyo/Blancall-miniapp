"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const cloze_1 = require("../core/algorithms/cloze");
const sentence_1 = require("../core/algorithms/sentence");
const types_1 = require("../core/algorithms/types");
const B = cloze_1.BlancallGenerator;
/** 用固定值替换 Math.random，让随机采样/打散可复现；结束后恢复 */
function withRandom(value, fn) {
    const orig = Math.random;
    Math.random = () => value;
    try {
        return fn();
    }
    finally {
        Math.random = orig;
    }
}
/** 断言：同一句内空区间互不重叠（半开区间 [start,end)） */
function assertNoOverlap(blanks) {
    var _a;
    const bySentence = new Map();
    for (const b of blanks) {
        const list = (_a = bySentence.get(b.sentenceIndex)) !== null && _a !== void 0 ? _a : [];
        list.push([b.startInSentence, b.endInSentence]);
        bySentence.set(b.sentenceIndex, list);
    }
    for (const list of bySentence.values()) {
        list.sort((a, b2) => a[0] - b2[0]);
        for (let i = 1; i < list.length; i++) {
            strict_1.default.ok(list[i][0] >= list[i - 1][1], `区间重叠: ${JSON.stringify(list)}`);
        }
    }
}
// ══════════════════════ 句子挖空 ══════════════════════
(0, node_test_1.default)('句子挖空：totalClauses==1 → 自动挖 1 个空（整句）', () => {
    const r = B.generateSentenceCloze('床前明月光。');
    strict_1.default.deepEqual(r.sentences, ['床前明月光。']);
    strict_1.default.equal(r.blanks.length, 1);
    strict_1.default.deepEqual(r.blanks[0], {
        index: 0,
        originalText: '床前明月光。',
        sentenceIndex: 0,
        startInSentence: 0,
        endInSentence: 6,
    });
    strict_1.default.equal(r.displayText, '[1] ___');
});
(0, node_test_1.default)('句子挖空：totalClauses<=4 → max(1, n/2)（n=3 →1，n=4 →2）', () => {
    const t3 = withRandom(0, () => B.generateSentenceCloze('一，二，三。'));
    strict_1.default.equal(t3.blanks.length, 1);
    strict_1.default.deepEqual(t3.blanks[0], {
        index: 0,
        originalText: '一',
        sentenceIndex: 0,
        startInSentence: 0,
        endInSentence: 1,
    });
    strict_1.default.equal(t3.displayText, '[1] ___\n二\n三。');
    const t4 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。'));
    strict_1.default.equal(t4.blanks.length, 2);
    strict_1.default.deepEqual(t4.blanks.map((b) => b.sentenceIndex), [0, 1]);
    strict_1.default.equal(t4.displayText, '[1] ___\n[2] ___\n三\n四。');
});
(0, node_test_1.default)('句子挖空：totalClauses>4 → max(1, n/3)（n=6 →2，n=9 →3）', () => {
    const t6 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四，五，六。'));
    strict_1.default.equal(t6.blanks.length, 2);
    const t9 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四，五，六，七，八，九。'));
    strict_1.default.equal(t9.blanks.length, 3);
});
(0, node_test_1.default)('句子挖空：指定 count 时 clamp 到 [1, total]，且 densityScale 恒为 1', () => {
    // count=10 但只有 4 个分句 → 收敛为 4
    const c10 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 10));
    strict_1.default.equal(c10.blanks.length, 4);
    // count 指定时不受 memoryFactor 放大
    const ep16 = (0, types_1.emptyErrorProfile)(1.6);
    const c2 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 2, ep16));
    strict_1.default.equal(c2.blanks.length, 2);
});
(0, node_test_1.default)('句子挖空：自动档受 memoryFactor 影响（1.6 → baseCount*1.6 截断）', () => {
    // 4 分句：baseCount=2；mf=1 → 2 个空；mf=1.6 → trunc(3.2)=3 个空
    const mf1 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 0, (0, types_1.emptyErrorProfile)(1)));
    strict_1.default.equal(mf1.blanks.length, 2);
    const mf16 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 0, (0, types_1.emptyErrorProfile)(1.6)));
    strict_1.default.equal(mf16.blanks.length, 3);
    // memoryFactor 上限 1.6（传 2.0 仍按 1.6）
    const mf2 = withRandom(0, () => B.generateSentenceCloze('一，二，三，四。', 0, (0, types_1.emptyErrorProfile)(2)));
    strict_1.default.equal(mf2.blanks.length, 3);
});
(0, node_test_1.default)('句子挖空：WEAKNESS_FOCUS 有句级数据时优先薄弱句（确定性）', () => {
    const ep = (0, types_1.emptyErrorProfile)();
    ep.sentenceErrorRates = { 0: 0.1, 1: 0.9 };
    const r = B.generateSentenceCloze('春眠，处处，夜来。风。', 2, ep, 'WEAKNESS_FOCUS');
    strict_1.default.deepEqual(r.blanks.map((b) => b.originalText), ['春眠，', '风。']);
    strict_1.default.deepEqual(r.blanks.map((b) => b.sentenceIndex), [0, 1]);
    const r1 = B.generateSentenceCloze('春眠，处处，夜来。风。', 1, ep, 'WEAKNESS_FOCUS');
    strict_1.default.equal(r1.blanks.length, 1);
    strict_1.default.equal(r1.blanks[0].originalText, '风。');
    strict_1.default.equal(r1.blanks[0].sentenceIndex, 1);
});
(0, node_test_1.default)('句子挖空：FULL_COVERAGE 均匀铺开（确定性，取 {0,2}）', () => {
    const r = B.generateSentenceCloze('春眠，处处，夜来。风。', 2, (0, types_1.emptyErrorProfile)(), 'FULL_COVERAGE');
    strict_1.default.deepEqual(r.blanks.map((b) => [b.originalText, b.startInSentence, b.endInSentence]), [
        ['春眠，', 0, 3],
        ['夜来。', 6, 9],
    ]);
    strict_1.default.equal(r.displayText, '[1] ___处处，[2] ___\n风。');
    assertNoOverlap(r.blanks);
});
(0, node_test_1.default)('句子挖空：BALANCED 与 FULL_COVERAGE 选题不同，且相邻分句合并为复句', () => {
    // 固定 random=0 → 均衡策略每次取剩余权重最低序位 → 选中 {0,1}（同一句内相邻 → 合并）
    const balanced = withRandom(0, () => B.generateSentenceCloze('春眠，处处，夜来。风。', 2, (0, types_1.emptyErrorProfile)(), 'BALANCED'));
    strict_1.default.equal(balanced.blanks.length, 1);
    strict_1.default.deepEqual(balanced.blanks[0], {
        index: 0,
        originalText: '春眠，处处，',
        sentenceIndex: 0,
        startInSentence: 0,
        endInSentence: 6,
    });
    strict_1.default.equal(balanced.displayText, '[1] ___夜来。\n风。');
    // 全覆盖策略取 {0,2}（同一句内不相邻 → 不合并，两个独立空）
    const full = B.generateSentenceCloze('春眠，处处，夜来。风。', 2, (0, types_1.emptyErrorProfile)(), 'FULL_COVERAGE');
    strict_1.default.equal(full.blanks.length, 2);
});
(0, node_test_1.default)('句子挖空：同一句内相邻分句合并（床前，月。 count=2 → 整句合并）', () => {
    const r = B.generateSentenceCloze('床前，月。', 2);
    strict_1.default.deepEqual(r.sentences, ['床前，月。']);
    strict_1.default.equal(r.blanks.length, 1);
    strict_1.default.deepEqual(r.blanks[0], {
        index: 0,
        originalText: '床前，月。',
        sentenceIndex: 0,
        startInSentence: 0,
        endInSentence: 5,
    });
    strict_1.default.equal(r.displayText, '[1] ___');
});
// ══════════════════════ 字词挖空 ══════════════════════
(0, node_test_1.default)('字词挖空：suggestedBlanks 分档（≤3/≤10/≤30/≤80/其他）', () => {
    const cases = [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 2], // max(2, 4/2)
        [8, 4], // max(2, 8/2)
        [10, 5], // max(2, 10/2)
        [11, 3], // max(3, 11/3)
        [12, 4], // max(3, 12/3)
        [30, 10], // max(3, 30/3)
        [31, 6], // max(4, 31/5)
        [80, 16], // max(4, 80/5)
        [81, 10], // max(5, 81/8)
        [100, 12], // max(5, 100/8)
    ];
    for (const [n, expected] of cases) {
        const r = B.generateWordCloze('一'.repeat(n));
        strict_1.default.equal(r.maxBlanks, n, `maxBlanks n=${n}`);
        strict_1.default.equal(r.suggestedBlanks, expected, `suggestedBlanks n=${n}`);
    }
});
(0, node_test_1.default)('字词挖空：maxBlanks = 汉字数 + 英文单词数，且贪心选取不重叠', () => {
    const r = B.generateWordCloze('Hello 汉字 world', 4);
    strict_1.default.equal(r.maxBlanks, 4);
    strict_1.default.equal(r.suggestedBlanks, 2);
    strict_1.default.deepEqual(r.blanks, [
        { index: 0, originalChar: 'Hello', position: 0 },
        { index: 1, originalChar: '汉', position: 6 },
        { index: 2, originalChar: '字', position: 7 },
        { index: 3, originalChar: 'world', position: 9 },
    ]);
    strict_1.default.equal(r.displayText, '___ ______ ___');
    strict_1.default.deepEqual(r.sentences, [{ text: '___ ______ ___', blanks: [0, 1, 2, 3] }]);
    // 所有候选互不重叠（按原文位置区间检查）
    const ranges = r.blanks.map((b) => [b.position, b.position + b.originalChar.length]);
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
        strict_1.default.ok(ranges[i][0] >= ranges[i - 1][1], `字词空重叠: ${JSON.stringify(ranges)}`);
    }
});
(0, node_test_1.default)('字词挖空：自动档（count=0）按 maxBlanks 分档并合并相邻空', () => {
    // maxBlanks=5 → 取全部选中项（5 个单字）→ 排序后相邻合并为整句一个空
    const r5 = B.generateWordCloze('床前明月光');
    strict_1.default.equal(r5.maxBlanks, 5);
    strict_1.default.deepEqual(r5.blanks, [{ index: 0, originalChar: '床前明月光', position: 0 }]);
    strict_1.default.equal(r5.displayText, '___');
    // maxBlanks=20 → max(1, 20/3)=6 → 前 6 个单字相邻合并为 6 字空
    const r20 = B.generateWordCloze('一'.repeat(20));
    strict_1.default.deepEqual(r20.blanks, [{ index: 0, originalChar: '一一一一一一', position: 0 }]);
    // maxBlanks=24 → max(1, 24/4)=6（>20 档）
    const r24 = B.generateWordCloze('一'.repeat(24));
    strict_1.default.deepEqual(r24.blanks, [{ index: 0, originalChar: '一一一一一一', position: 0 }]);
});
(0, node_test_1.default)('字词挖空：指定数够用时直接截取（不合并）', () => {
    // 无错误历史：贪心选中 5 个单字，取难度前 4 → 床/前/明/光
    const r = B.generateWordCloze('床前明月光', 4);
    strict_1.default.deepEqual(r.blanks, [
        { index: 0, originalChar: '床', position: 0 },
        { index: 1, originalChar: '前', position: 1 },
        { index: 2, originalChar: '明', position: 2 },
        { index: 3, originalChar: '光', position: 4 },
    ]);
});
(0, node_test_1.default)('字词挖空：指定数不足时走补齐/全单字重选路径', () => {
    const ep = (0, types_1.emptyErrorProfile)();
    // 词级错误把「明月」抬成最高难度 → 贪心选中占位过多 → 触发补充/重选
    ep.wordErrorRates = { 明月: 1 };
    // count=4 → 目标 <= 贪心选中数(4) → 保留多字词「明月」
    const r4 = B.generateWordCloze('床前明月光', 4, ep);
    strict_1.default.deepEqual(r4.blanks, [
        { index: 0, originalChar: '床', position: 0 },
        { index: 1, originalChar: '前', position: 1 },
        { index: 2, originalChar: '明月', position: 2 },
        { index: 3, originalChar: '光', position: 4 },
    ]);
    // count=5 → 贪心多字占位过多导致候选不足 → 全部改用单字重选（5 个单字）
    const r5 = B.generateWordCloze('床前明月光', 5, ep);
    strict_1.default.deepEqual(r5.blanks, [
        { index: 0, originalChar: '床', position: 0 },
        { index: 1, originalChar: '前', position: 1 },
        { index: 2, originalChar: '明', position: 2 },
        { index: 3, originalChar: '月', position: 3 },
        { index: 4, originalChar: '光', position: 4 },
    ]);
    // count 超过 maxBlanks → clamp 到 5
    const rc = B.generateWordCloze('床前明月光', 99);
    strict_1.default.equal(rc.blanks.length, 5);
});
(0, node_test_1.default)('字词挖空：候选为空时原样返回（无中英文可挖）', () => {
    const r = B.generateWordCloze('123，456。');
    strict_1.default.equal(r.blanks.length, 0);
    strict_1.default.equal(r.maxBlanks, 0);
    strict_1.default.equal(r.suggestedBlanks, 0);
    strict_1.default.equal(r.displayText, '123，456。');
});
// ══════════════════════ 反向默写 ══════════════════════
(0, node_test_1.default)('反向默写：分句切分 + 每分句挖 1 空 + 打散（含确定性样例）', () => {
    const r = withRandom(0, () => B.generateDictation('床前明月光，疑是地上霜。'));
    strict_1.default.deepEqual(r.clauses, ['床前明月光，', '疑是地上霜。']);
    strict_1.default.equal(r.shuffledClauses.length, 2);
    // 固定 random=0 的 Fisher-Yates 结果：[1, 0]
    strict_1.default.deepEqual(r.shuffledClauses.map((s) => s.displayOrder), [0, 1]);
    strict_1.default.deepEqual(r.shuffledClauses.map((s) => s.originalIndex), [1, 0]);
    strict_1.default.equal(r.shuffledClauses[0].originalText, '疑是地上霜。');
    strict_1.default.equal(r.shuffledClauses[0].displayText, '疑是地上___。');
    strict_1.default.equal(r.shuffledClauses[1].originalText, '床前明月光，');
    strict_1.default.equal(r.shuffledClauses[1].displayText, '___前明月光，');
});
(0, node_test_1.default)('反向默写：打散结果是原文分句的一个排列', () => {
    const src = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
    const r = B.generateDictation(src);
    strict_1.default.equal(r.clauses.length, 4);
    strict_1.default.deepEqual(r.clauses, ['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。']);
    const idx = r.shuffledClauses.map((s) => s.originalIndex).sort((a, b) => a - b);
    strict_1.default.deepEqual(idx, [0, 1, 2, 3]);
    for (const s of r.shuffledClauses) {
        strict_1.default.equal(s.originalText, r.clauses[s.originalIndex]);
        strict_1.default.ok(s.displayText.includes('___'), '挖空分句应含 ___');
    }
});
(0, node_test_1.default)('反向默写：buildCustomDictation 只保留选中句', () => {
    const src = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
    const r = B.buildCustomDictation(src, new Set([1]));
    strict_1.default.deepEqual(r.clauses, ['举头望明月，', '低头思故乡。']);
    strict_1.default.equal(r.shuffledClauses.length, 2);
    // 空集合 → 空结果
    strict_1.default.deepEqual(B.buildCustomDictation(src, new Set()), { clauses: [], shuffledClauses: [] });
    // 空白文本 → 空结果
    strict_1.default.deepEqual(B.generateDictation('   '), { clauses: [], shuffledClauses: [] });
});
(0, node_test_1.default)('反向默写：切分标点保留在前一分句末尾', () => {
    const r = withRandom(0, () => B.generateDictation('春眠不觉晓，处处闻啼鸟；夜来风雨声，花落知多少。'));
    strict_1.default.deepEqual(r.clauses, ['春眠不觉晓，', '处处闻啼鸟；', '夜来风雨声，', '花落知多少。']);
});
// ══════════════════════ 自定义句子挖空 ══════════════════════
(0, node_test_1.default)('buildCustomSentenceCloze：按句内区间构造，displayText 用 [N] ___ 标记', () => {
    const r = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map([[0, [{ first: 0, last: 2 }, { first: 4, last: 4 }]]]));
    strict_1.default.deepEqual(r.blanks, [
        { index: 0, originalText: '床前明', sentenceIndex: 0, startInSentence: 0, endInSentence: 3 },
        { index: 1, originalText: '光', sentenceIndex: 0, startInSentence: 4, endInSentence: 5 },
    ]);
    strict_1.default.equal(r.displayText, '[1] ___月[2] ___，疑是地上霜。');
    assertNoOverlap(r.blanks);
});
(0, node_test_1.default)('buildCustomSentenceCloze：相邻/重叠区间自动合并，越界自动裁剪', () => {
    // 相邻区间 [0,2] 与 [3,4] 合并为 [0,4]
    const merged = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map([[0, [{ first: 0, last: 2 }, { first: 3, last: 4 }]]]));
    strict_1.default.deepEqual(merged.blanks, [
        { index: 0, originalText: '床前明月光', sentenceIndex: 0, startInSentence: 0, endInSentence: 5 },
    ]);
    strict_1.default.equal(merged.displayText, '[1] ___，疑是地上霜。');
    // 越界区间裁剪到句长；不存在的句索引被忽略
    const clamped = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map([
        [0, [{ first: 0, last: 100 }]],
        [5, [{ first: 0, last: 2 }]],
    ]));
    strict_1.default.deepEqual(clamped.blanks, [
        { index: 0, originalText: '床前明月光，疑是地上霜。', sentenceIndex: 0, startInSentence: 0, endInSentence: 12 },
    ]);
    strict_1.default.equal(clamped.displayText, '[1] ___');
    // 空选择 → 无空、displayText 为原文
    const empty = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map());
    strict_1.default.deepEqual(empty.blanks, []);
    strict_1.default.equal(empty.displayText, '床前明月光，疑是地上霜。');
});
// ══════════════════════ 虚词 ══════════════════════
(0, node_test_1.default)('isFunctionWord：单字查表，多字看首尾字', () => {
    strict_1.default.equal(B.isFunctionWord('之'), true);
    strict_1.default.equal(B.isFunctionWord('者'), true);
    strict_1.default.equal(B.isFunctionWord('的'), true);
    strict_1.default.equal(B.isFunctionWord(''), false);
    strict_1.default.equal(B.isFunctionWord('明月'), false);
    strict_1.default.equal(B.isFunctionWord('明月光'), false);
    // 首字虚词 → true
    strict_1.default.equal(B.isFunctionWord('之所'), true);
    // 尾字虚词 → true
    strict_1.default.equal(B.isFunctionWord('求之'), true);
});
// ══════════════════════ JSON 序列化 ══════════════════════
(0, node_test_1.default)('JSON key 名与 Kotlin org.json 输出逐字一致', () => {
    const s = B.generateSentenceCloze('床前，月。', 2);
    const so = JSON.parse(B.sentenceClozeToJson(s));
    strict_1.default.deepEqual(Object.keys(so), ['sentences', 'blanks', 'displayText']);
    strict_1.default.deepEqual(Object.keys(so.blanks[0]), ['index', 'originalText', 'sentenceIndex', 'startInSentence', 'endInSentence']);
    const w = B.generateWordCloze('Hello 汉字 world', 4);
    const wo = JSON.parse(B.wordClozeToJson(w));
    strict_1.default.deepEqual(Object.keys(wo), ['sentences', 'blanks', 'displayText', 'maxBlanks', 'suggestedBlanks']);
    strict_1.default.deepEqual(Object.keys(wo.sentences[0]), ['text', 'blanks']);
    strict_1.default.deepEqual(Object.keys(wo.blanks[0]), ['index', 'originalChar', 'position']);
    const d = withRandom(0, () => B.generateDictation('床前明月光，疑是地上霜。'));
    const do_ = JSON.parse(B.dictationToJson(d));
    strict_1.default.deepEqual(Object.keys(do_), ['clauses', 'shuffledClauses']);
    strict_1.default.deepEqual(Object.keys(do_.shuffledClauses[0]), ['displayOrder', 'originalIndex', 'originalText', 'displayText']);
});
(0, node_test_1.default)('JSON 往返：xxxFromJson(xxxToJson(r)) 与 r 深度相等', () => {
    const s = B.generateSentenceCloze('床前明月光，疑是地上霜。', 2);
    strict_1.default.deepEqual(B.sentenceClozeFromJson(B.sentenceClozeToJson(s)), s);
    const w = B.generateWordCloze('Hello 汉字 world', 4);
    strict_1.default.deepEqual(B.wordClozeFromJson(B.wordClozeToJson(w)), w);
    const d = withRandom(0.37, () => B.generateDictation('床前明月光，疑是地上霜。举头望明月。'));
    strict_1.default.deepEqual(B.dictationFromJson(B.dictationToJson(d)), d);
    const custom = B.buildCustomSentenceCloze('床前明月光，疑是地上霜。', new Map([[0, [{ first: 0, last: 2 }]]]));
    strict_1.default.deepEqual(B.sentenceClozeFromJson(B.sentenceClozeToJson(custom)), custom);
});
(0, node_test_1.default)('JSON 反序列化：非法输入返回 null', () => {
    strict_1.default.equal(B.sentenceClozeFromJson('{bad json'), null);
    strict_1.default.equal(B.sentenceClozeFromJson('{"sentences":[]}'), null); // 缺 blanks/displayText
    strict_1.default.equal(B.wordClozeFromJson('[]'), null);
    strict_1.default.equal(B.wordClozeFromJson('{"sentences":[],"blanks":[],"displayText":"","maxBlanks":1}'), null); // 缺 suggestedBlanks
    strict_1.default.equal(B.dictationFromJson('null'), null);
    strict_1.default.equal(B.dictationFromJson('{"clauses":[]}'), null); // 缺 shuffledClauses
});
// ══════════════════════ 分句器（依赖） ══════════════════════
(0, node_test_1.default)('SentenceSplitter.split/splitWithPositions 供挖空使用', () => {
    const text = '床前明月光，疑是地上霜。举头望明月。';
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.split(text), ['床前明月光，疑是地上霜。', '举头望明月。']);
    strict_1.default.deepEqual(sentence_1.SentenceSplitter.splitWithPositions(text), [
        { text: '床前明月光，疑是地上霜。', startIndex: 0, endIndex: 12 },
        { text: '举头望明月。', startIndex: 12, endIndex: 18 },
    ]);
});
