"use strict";
// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// 遮挡块纯逻辑操作（原 Android 遮挡编辑器私有实现上移，行为不变）。
// 对应 Kotlin `com.ilyskyo.blancall.algorithm.MaskSpanOps`。
// 全部为无副作用纯函数，便于单元测试锁定语义。
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaskSpanOps = void 0;
/** 两块遮挡是否值相等（对应 Kotlin data class 的结构相等，用于 `- hits.toSet()`） */
function spanEquals(x, y) {
    return x.p === y.p && x.a === y.a && x.e === y.e && x.c === y.c;
}
/**
 * 点选切换遮挡语义（对应 Kotlin `MaskSpanOps.toggle`）：
 * - 命中已遮块且完整覆盖本次区间 → 仅取消（移除命中块）
 * - 命中已遮块但未完整覆盖 → 移除命中块后按新区间整块遮上（替换，如点词盖过字块）
 * - 未命中且区间有效（e > a）→ 新增整块
 * 命中判定：同段落且区间相交（`it.a < e && a < it.e`）。
 */
function toggle(spans, p, a, e, color) {
    const hits = spans.filter((s) => s.p === p && s.a < e && a < s.e);
    let result = spans;
    if (hits.length > 0) {
        // 等价 Kotlin `result - hits.toSet()`：按值移除所有命中块（含重复项）
        result = result.filter((s) => !hits.some((h) => spanEquals(h, s)));
        if (hits.some((h) => h.a <= a && h.e >= e))
            return result;
    }
    if (e > a)
        result = result.concat([{ p, a, e, c: color }]);
    return result;
}
/**
 * 合并同段内同色相邻/重叠块，返回按段序、起点升序的规范 spans（保存用）。
 * 对应 Kotlin `MaskSpanOps.merge`：
 * - 按 p 分组并升序（toSortedMap）；
 * - 组内按 a 稳定升序折叠，仅当「同色且 s.a <= last.e」时延展 last.e = max(last.e, s.e)；
 * - 颜色不同不合并（重叠块各自保留），与源码一致。
 */
function merge(spans) {
    const byP = new Map();
    for (const s of spans) {
        const arr = byP.get(s.p);
        if (arr)
            arr.push(s);
        else
            byP.set(s.p, [s]);
    }
    const keys = Array.from(byP.keys()).sort((x, y) => x - y);
    const out = [];
    for (const p of keys) {
        const list = byP.get(p)
            .map((s, idx) => ({ s, idx }))
            .sort((x, y) => x.s.a - y.s.a || x.idx - y.idx)
            .map((it) => it.s);
        const acc = [];
        for (const s of list) {
            const last = acc.length > 0 ? acc[acc.length - 1] : null;
            if (last !== null && last.c === s.c && s.a <= last.e) {
                acc[acc.length - 1] = { p: last.p, a: last.a, e: Math.max(last.e, s.e), c: last.c };
            }
            else {
                acc.push(s);
            }
        }
        out.push(...acc);
    }
    return out;
}
exports.MaskSpanOps = {
    toggle,
    merge,
};
