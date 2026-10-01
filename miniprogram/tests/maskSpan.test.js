"use strict";
// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// MaskSpanOps（toggle / merge）测试
// 期望值逐条人工推导，语义对照 Kotlin `MaskSpanOps` 源码。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const maskSpan_1 = require("../core/algorithms/maskSpan");
(0, node_test_1.default)('toggle：未命中且区间有效 → 新增整块（追加到末尾）', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([], 0, 2, 5, 1), [{ p: 0, a: 2, e: 5, c: 1 }]);
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 0, e: 2, c: 1 }], 0, 5, 8, 2), [
        { p: 0, a: 0, e: 2, c: 1 },
        { p: 0, a: 5, e: 8, c: 2 },
    ]);
});
(0, node_test_1.default)('toggle：非法区间（e<=a）不新增', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([], 0, 2, 2, 1), []);
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([], 0, 5, 3, 1), []);
});
(0, node_test_1.default)('toggle：命中且完整覆盖 → 仅移除，不新增（颜色忽略）', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 2, e: 5, c: 1 }], 0, 2, 5, 9), []);
    // 点小范围（3,5）→ 被整块覆盖 → 移除后不补新块
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 0, e: 10, c: 1 }], 0, 3, 5, 2), []);
});
(0, node_test_1.default)('toggle：命中但未完整覆盖 → 移除命中块后按新区间整块遮上（替换）', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 2, e: 3, c: 1 }], 0, 2, 6, 4), [{ p: 0, a: 2, e: 6, c: 4 }]);
});
(0, node_test_1.default)('toggle：命中的块全部按值移除（含重复项）', () => {
    const spans = [
        { p: 0, a: 1, e: 4, c: 2 },
        { p: 0, a: 1, e: 4, c: 2 },
        { p: 0, a: 8, e: 9, c: 2 },
    ];
    // 命中 (1,4) 两块且完整覆盖 → 都被移除，保留 (8,9)
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle(spans, 0, 1, 4, 7), [{ p: 0, a: 8, e: 9, c: 2 }]);
});
(0, node_test_1.default)('toggle：不同段落不互相命中', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 2, e: 5, c: 1 }], 1, 2, 5, 1), [
        { p: 0, a: 2, e: 5, c: 1 },
        { p: 1, a: 2, e: 5, c: 1 },
    ]);
});
(0, node_test_1.default)('toggle：区间仅相接触（共享端点）不算命中', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 2, e: 5, c: 1 }], 0, 5, 8, 1), [
        { p: 0, a: 2, e: 5, c: 1 },
        { p: 0, a: 5, e: 8, c: 1 },
    ]);
});
(0, node_test_1.default)('toggle：待遮盖区间与已有块相交但 e<=a 时，仍按命中语义处理', () => {
    // (5,4) 非有效区间，但与 (2,8) 相交且被其覆盖 → 移除，且不新增
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 2, e: 8, c: 1 }], 0, 5, 4, 1), []);
    // (5,5) 与 (5,8) 相交？it.a<e → 5<5 假 → 未命中 → 原样返回
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.toggle([{ p: 0, a: 5, e: 8, c: 1 }], 0, 5, 5, 1), [
        { p: 0, a: 5, e: 8, c: 1 },
    ]);
});
(0, node_test_1.default)('merge：同色相邻/重叠合并，延展终点', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 0, a: 0, e: 2, c: 1 },
        { p: 0, a: 2, e: 5, c: 1 },
    ]), [{ p: 0, a: 0, e: 5, c: 1 }]);
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 0, a: 0, e: 3, c: 1 },
        { p: 0, a: 2, e: 5, c: 1 },
    ]), [{ p: 0, a: 0, e: 5, c: 1 }]);
    // e 取 max：被包含块不缩短
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 0, a: 0, e: 5, c: 1 },
        { p: 0, a: 1, e: 2, c: 1 },
    ]), [{ p: 0, a: 0, e: 5, c: 1 }]);
});
(0, node_test_1.default)('merge：同色不相邻不合并', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 0, a: 0, e: 2, c: 1 },
        { p: 0, a: 3, e: 5, c: 1 },
    ]), [
        { p: 0, a: 0, e: 2, c: 1 },
        { p: 0, a: 3, e: 5, c: 1 },
    ]);
});
(0, node_test_1.default)('merge：颜色不同不合并（相邻与重叠均各自保留，重叠不消解）', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 0, a: 0, e: 2, c: 1 },
        { p: 0, a: 2, e: 5, c: 2 },
    ]), [
        { p: 0, a: 0, e: 2, c: 1 },
        { p: 0, a: 2, e: 5, c: 2 },
    ]);
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 0, a: 0, e: 3, c: 1 },
        { p: 0, a: 2, e: 5, c: 2 },
    ]), [
        { p: 0, a: 0, e: 3, c: 1 },
        { p: 0, a: 2, e: 5, c: 2 },
    ]);
});
(0, node_test_1.default)('merge：结果按段序升序、段内起点升序（输入乱序也能规范化）', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([
        { p: 1, a: 0, e: 2, c: 1 },
        { p: 0, a: 3, e: 5, c: 2 },
        { p: 0, a: 0, e: 3, c: 2 },
    ]), [
        { p: 0, a: 0, e: 5, c: 2 },
        { p: 1, a: 0, e: 2, c: 1 },
    ]);
});
(0, node_test_1.default)('merge：空输入返回空数组，且不修改入参', () => {
    strict_1.default.deepEqual(maskSpan_1.MaskSpanOps.merge([]), []);
    const input = [
        { p: 0, a: 0, e: 4, c: 1 },
        { p: 0, a: 2, e: 2, c: 1 },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    maskSpan_1.MaskSpanOps.merge(input);
    strict_1.default.deepEqual(input, snapshot);
});
