// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// MaskSpanOps（toggle / merge）测试
// 期望值逐条人工推导，语义对照 Kotlin `MaskSpanOps` 源码。

import test from 'node:test';
import assert from 'node:assert/strict';
import { MaskSpanOps, type MaskSpan } from '../core/algorithms/maskSpan';

test('toggle：未命中且区间有效 → 新增整块（追加到末尾）', () => {
  assert.deepEqual(MaskSpanOps.toggle([], 0, 2, 5, 1), [{ p: 0, a: 2, e: 5, c: 1 }]);
  assert.deepEqual(
    MaskSpanOps.toggle([{ p: 0, a: 0, e: 2, c: 1 }], 0, 5, 8, 2),
    [
      { p: 0, a: 0, e: 2, c: 1 },
      { p: 0, a: 5, e: 8, c: 2 },
    ]
  );
});

test('toggle：非法区间（e<=a）不新增', () => {
  assert.deepEqual(MaskSpanOps.toggle([], 0, 2, 2, 1), []);
  assert.deepEqual(MaskSpanOps.toggle([], 0, 5, 3, 1), []);
});

test('toggle：命中且完整覆盖 → 仅移除，不新增（颜色忽略）', () => {
  assert.deepEqual(MaskSpanOps.toggle([{ p: 0, a: 2, e: 5, c: 1 }], 0, 2, 5, 9), []);
  // 点小范围（3,5）→ 被整块覆盖 → 移除后不补新块
  assert.deepEqual(MaskSpanOps.toggle([{ p: 0, a: 0, e: 10, c: 1 }], 0, 3, 5, 2), []);
});

test('toggle：命中但未完整覆盖 → 移除命中块后按新区间整块遮上（替换）', () => {
  assert.deepEqual(
    MaskSpanOps.toggle([{ p: 0, a: 2, e: 3, c: 1 }], 0, 2, 6, 4),
    [{ p: 0, a: 2, e: 6, c: 4 }]
  );
});

test('toggle：命中的块全部按值移除（含重复项）', () => {
  const spans: MaskSpan[] = [
    { p: 0, a: 1, e: 4, c: 2 },
    { p: 0, a: 1, e: 4, c: 2 },
    { p: 0, a: 8, e: 9, c: 2 },
  ];
  // 命中 (1,4) 两块且完整覆盖 → 都被移除，保留 (8,9)
  assert.deepEqual(MaskSpanOps.toggle(spans, 0, 1, 4, 7), [{ p: 0, a: 8, e: 9, c: 2 }]);
});

test('toggle：不同段落不互相命中', () => {
  assert.deepEqual(
    MaskSpanOps.toggle([{ p: 0, a: 2, e: 5, c: 1 }], 1, 2, 5, 1),
    [
      { p: 0, a: 2, e: 5, c: 1 },
      { p: 1, a: 2, e: 5, c: 1 },
    ]
  );
});

test('toggle：区间仅相接触（共享端点）不算命中', () => {
  assert.deepEqual(
    MaskSpanOps.toggle([{ p: 0, a: 2, e: 5, c: 1 }], 0, 5, 8, 1),
    [
      { p: 0, a: 2, e: 5, c: 1 },
      { p: 0, a: 5, e: 8, c: 1 },
    ]
  );
});

test('toggle：待遮盖区间与已有块相交但 e<=a 时，仍按命中语义处理', () => {
  // (5,4) 非有效区间，但与 (2,8) 相交且被其覆盖 → 移除，且不新增
  assert.deepEqual(MaskSpanOps.toggle([{ p: 0, a: 2, e: 8, c: 1 }], 0, 5, 4, 1), []);
  // (5,5) 与 (5,8) 相交？it.a<e → 5<5 假 → 未命中 → 原样返回
  assert.deepEqual(MaskSpanOps.toggle([{ p: 0, a: 5, e: 8, c: 1 }], 0, 5, 5, 1), [
    { p: 0, a: 5, e: 8, c: 1 },
  ]);
});

test('merge：同色相邻/重叠合并，延展终点', () => {
  assert.deepEqual(MaskSpanOps.merge([
    { p: 0, a: 0, e: 2, c: 1 },
    { p: 0, a: 2, e: 5, c: 1 },
  ]), [{ p: 0, a: 0, e: 5, c: 1 }]);
  assert.deepEqual(MaskSpanOps.merge([
    { p: 0, a: 0, e: 3, c: 1 },
    { p: 0, a: 2, e: 5, c: 1 },
  ]), [{ p: 0, a: 0, e: 5, c: 1 }]);
  // e 取 max：被包含块不缩短
  assert.deepEqual(MaskSpanOps.merge([
    { p: 0, a: 0, e: 5, c: 1 },
    { p: 0, a: 1, e: 2, c: 1 },
  ]), [{ p: 0, a: 0, e: 5, c: 1 }]);
});

test('merge：同色不相邻不合并', () => {
  assert.deepEqual(MaskSpanOps.merge([
    { p: 0, a: 0, e: 2, c: 1 },
    { p: 0, a: 3, e: 5, c: 1 },
  ]), [
    { p: 0, a: 0, e: 2, c: 1 },
    { p: 0, a: 3, e: 5, c: 1 },
  ]);
});

test('merge：颜色不同不合并（相邻与重叠均各自保留，重叠不消解）', () => {
  assert.deepEqual(MaskSpanOps.merge([
    { p: 0, a: 0, e: 2, c: 1 },
    { p: 0, a: 2, e: 5, c: 2 },
  ]), [
    { p: 0, a: 0, e: 2, c: 1 },
    { p: 0, a: 2, e: 5, c: 2 },
  ]);
  assert.deepEqual(MaskSpanOps.merge([
    { p: 0, a: 0, e: 3, c: 1 },
    { p: 0, a: 2, e: 5, c: 2 },
  ]), [
    { p: 0, a: 0, e: 3, c: 1 },
    { p: 0, a: 2, e: 5, c: 2 },
  ]);
});

test('merge：结果按段序升序、段内起点升序（输入乱序也能规范化）', () => {
  assert.deepEqual(MaskSpanOps.merge([
    { p: 1, a: 0, e: 2, c: 1 },
    { p: 0, a: 3, e: 5, c: 2 },
    { p: 0, a: 0, e: 3, c: 2 },
  ]), [
    { p: 0, a: 0, e: 5, c: 2 },
    { p: 1, a: 0, e: 2, c: 1 },
  ]);
});

test('merge：空输入返回空数组，且不修改入参', () => {
  assert.deepEqual(MaskSpanOps.merge([]), []);
  const input: MaskSpan[] = [
    { p: 0, a: 0, e: 4, c: 1 },
    { p: 0, a: 2, e: 2, c: 1 },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  MaskSpanOps.merge(input);
  assert.deepEqual(input, snapshot);
});