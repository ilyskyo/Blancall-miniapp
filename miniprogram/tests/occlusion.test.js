"use strict";
// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// ReaderOcclusion（本地三粒度遮挡 + 自定义遮罩转渲染片段）测试
// 期望值逐条人工推导：难度取自 DifficultyCalculator 既有实现（其自身有独立测试），
// 混合遮挡的稳定性与区间顺序由 Python 复刻 Kotlin 位运算交叉验证。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const occlusion_1 = require("../core/algorithms/occlusion");
(0, node_test_1.default)('splitParagraphs：空行切段并记录 trim 后的原文起止', () => {
    const paras = occlusion_1.ReaderOcclusion.splitParagraphs('第一段。\n\n第二段璀璨。');
    strict_1.default.deepEqual(paras, [
        { start: 0, end: 4, text: '第一段。' },
        { start: 6, end: 12, text: '第二段璀璨。' },
    ]);
});
(0, node_test_1.default)('splitParagraphs：空/全空白输入返回空数组', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.splitParagraphs(''), []);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.splitParagraphs('  \n\n \n '), []);
});
(0, node_test_1.default)('clauseRanges：按逗号/句号等分句标点切分，区间含句末标点', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.clauseRanges('璀璨，星空的璀璨。'), [
        { start: 0, end: 3 },
        { start: 3, end: 9 },
    ]);
});
(0, node_test_1.default)('long：整分句遮挡（含句末标点），纯英文句点也整句遮', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('璀璨，星空的璀璨。', 'long'), [
        { start: 0, end: 3 },
        { start: 3, end: 9 },
    ]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('I love programming languages.', 'long'), [
        { start: 0, end: 29 },
    ]);
});
(0, node_test_1.default)('long/short：无汉字且无 ≥3 字母拉丁词的句子不遮挡', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('Hi.', 'long'), []);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('Hi.', 'short'), []);
});
(0, node_test_1.default)('short：每分句取难度≥0.35 的最多 3 个汉字（按难度降序输出）', () => {
    // 「璀璨的星空。」中 璀/璨 = 0.3833（≥0.35），星=0.24、空=0.2167、的=0.2167 均不足
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('璀璨的星空。', 'short'), [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
    ]);
    // 难度降序：撇 0.4767 / 漠 0.4533 / 曦 0.3833 → 输出顺序 (2,3)(1,2)(0,1)
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('曦漠撇的。', 'short'), [
        { start: 2, end: 3 },
        { start: 1, end: 2 },
        { start: 0, end: 1 },
    ]);
});
(0, node_test_1.default)('short：英文按「≥3 字母、最长 2 个词」挑词，每词独立成块', () => {
    // apple(5) banana(6) cherry(6) date(4) → 取最长两个 banana(6,12)/cherry(13,19)
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('apple banana cherry date.', 'short'), [
        { start: 6, end: 12 },
        { start: 13, end: 19 },
    ]);
    // to(2) 被排除；cat(3)/dog(3) 均达标
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('to cat dog.', 'short'), [
        { start: 3, end: 6 },
        { start: 7, end: 10 },
    ]);
});
(0, node_test_1.default)('short：多分句分别取字，输出顺序为「字块在前、词块在后」', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('璀璨，星空的璀璨。', 'short'), [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 6, end: 7 },
        { start: 7, end: 8 },
    ]);
});
(0, node_test_1.default)('mixed：逐句以稳定伪随机在长短间二选一（固定样例逐区间断言）', () => {
    // 段长 9：clause(0,3) → (0+9) 奇 → 短；clause(3,9) → (3+9) 偶 → 长
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('璀璨，星空的璀璨。', 'mixed'), [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 3, end: 9 },
    ]);
    // 段长 6：唯一分句(0,6) → (0+6) 偶 → 长
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('璀璨的星空。', 'mixed'), [{ start: 0, end: 6 }]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('星空的璀璨。', 'mixed'), [{ start: 0, end: 6 }]);
});
(0, node_test_1.default)('mixed：确定性——同输入两次调用结果一致', () => {
    const a = occlusion_1.ReaderOcclusion.localRangesInPara('璀璨，星空的璀璨。', 'mixed');
    const b = occlusion_1.ReaderOcclusion.localRangesInPara('璀璨，星空的璀璨。', 'mixed');
    strict_1.default.deepEqual(a, b);
    // 未知模式回退为短遮挡
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRangesInPara('璀璨的星空。', 'unknown'), [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
    ]);
});
(0, node_test_1.default)('localRanges：整篇遮挡（区间平移到全局坐标）', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.localRanges('第一段。\n\n第二段璀璨。', 'long'), [
        { start: 0, end: 4 },
        { start: 6, end: 12 },
    ]);
});
(0, node_test_1.default)('editUnits：level=1 汉字每 2 字一块，标点并入前单元，英文整词', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('你好世界', 1), [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
    ]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('你好，世界', 1), [
        { start: 0, end: 3 },
        { start: 3, end: 5 },
    ]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('hello world', 1), [
        { start: 0, end: 6 },
        { start: 6, end: 11 },
    ]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('你好, world', 1), [
        { start: 0, end: 4 },
        { start: 4, end: 9 },
    ]);
});
(0, node_test_1.default)('editUnits：level>=2 单字一块；level<=0 整段一块；空串空数组', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('你好世界', 2), [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 2, end: 3 },
        { start: 3, end: 4 },
    ]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('你好', 0), [{ start: 0, end: 2 }]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.editUnits('', 1), []);
});
(0, node_test_1.default)('customMasks：MaskSpanData{p,a,e,c} 按段落对齐并校验段内区间', () => {
    const content = '第一段。\n\n第二段璀璨。';
    const masks = occlusion_1.ReaderOcclusion.customMasks(content, [
        { p: 1, a: 0, e: 2, c: 3 },
        { p: 1, a: 0, e: 2, c: 3 }, // 重复 → 去重
        { p: 0, a: 0, e: 9, c: 1 }, // 越界（段长 4）→ 丢弃
        { p: 5, a: 0, e: 2, c: 1 }, // 无此段 → 丢弃
    ]);
    strict_1.default.deepEqual(masks, [
        { index: 0, text: '第一段。', ranges: [] },
        { index: 1, text: '第二段璀璨。', ranges: [{ start: 0, end: 2, colorIndex: 3 }] },
    ]);
});
(0, node_test_1.default)('toRenderSegments：把一段正文切成普通/遮挡片段序列', () => {
    const segs = occlusion_1.ReaderOcclusion.toRenderSegments('璀璨的星空。', [{ start: 2, end: 4, colorIndex: 1 }]);
    strict_1.default.deepEqual(segs, [
        { text: '璀璨', start: 0, end: 2, occluded: false, colorIndex: -1 },
        { text: '的星', start: 2, end: 4, occluded: true, colorIndex: 1 },
        { text: '空。', start: 4, end: 6, occluded: false, colorIndex: -1 },
    ]);
});
(0, node_test_1.default)('toRenderSegments：重叠区间按起点小者优先，完全被覆盖者跳过', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.toRenderSegments('abcdef', [
        { start: 0, end: 3, colorIndex: 0 },
        { start: 2, end: 5, colorIndex: 1 },
    ]), [
        { text: 'abc', start: 0, end: 3, occluded: true, colorIndex: 0 },
        { text: 'de', start: 3, end: 5, occluded: true, colorIndex: 1 },
        { text: 'f', start: 5, end: 6, occluded: false, colorIndex: -1 },
    ]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.toRenderSegments('abcdef', [
        { start: 0, end: 5, colorIndex: 0 },
        { start: 1, end: 2, colorIndex: 1 },
    ]), [
        { text: 'abcde', start: 0, end: 5, occluded: true, colorIndex: 0 },
        { text: 'f', start: 5, end: 6, occluded: false, colorIndex: -1 },
    ]);
});
(0, node_test_1.default)('toRenderSegments：非法区间丢弃；空段返回空数组', () => {
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.toRenderSegments('abcdef', [
        { start: 3, end: 3, colorIndex: 0 },
        { start: -1, end: 2, colorIndex: 1 },
    ]), [{ text: 'abcdef', start: 0, end: 6, occluded: false, colorIndex: -1 }]);
    strict_1.default.deepEqual(occlusion_1.ReaderOcclusion.toRenderSegments('', [{ start: 0, end: 1, colorIndex: 0 }]), []);
});
(0, node_test_1.default)('OcclusionSpan 类型结构（start/end 半开区间）', () => {
    const sp = { start: 1, end: 3 };
    strict_1.default.equal(sp.end - sp.start, 2);
});
