"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const oplogLogic_1 = require("../core/storage/oplogLogic");
function op(entity, uuid, updatedAt) {
    return { entity, op: 'upsert', uuid, updatedAt };
}
function records(n, base = 0) {
    return Array.from({ length: n }, (_, i) => op('practice_record', `r${base + i}`, 1000 + i));
}
function articles(n, base = 0) {
    return Array.from({ length: n }, (_, i) => op('article', `a${base + i}`, 1000 + i));
}
// ============================== 去重 ==============================
(0, node_test_1.default)('dedupeOps：同一实体只保留最新一条，并按 updatedAt 升序', () => {
    const list = [op('article', 'a1', 300), op('article', 'a1', 100), op('article', 'a1', 200)];
    const out = (0, oplogLogic_1.dedupeOps)(list);
    strict_1.default.equal(out.length, 1);
    strict_1.default.equal(out[0].updatedAt, 200);
});
(0, node_test_1.default)('dedupeOps：不同实体同 uuid 互不覆盖', () => {
    const out = (0, oplogLogic_1.dedupeOps)([op('article', 'x', 1), op('tag', 'x', 2)]);
    strict_1.default.equal(out.length, 2);
    strict_1.default.deepEqual(out.map(oplogLogic_1.opKey), ['article:x', 'tag:x']);
});
// ============================== 裁剪 ==============================
(0, node_test_1.default)('trimOps：未超限不裁剪', () => {
    const list = articles(10);
    const res = (0, oplogLogic_1.trimOps)(list);
    strict_1.default.equal(res.trimmed, 0);
    strict_1.default.equal(res.ops.length, 10);
    strict_1.default.equal(res.droppedOthers, 0);
});
(0, node_test_1.default)('trimOps：记录类占满上限时仍保留非记录类最小配额（回归：曾把文章/配置全部丢弃）', () => {
    const list = [...articles(500), ...records(oplogLogic_1.MAX_OPS + 300)];
    const res = (0, oplogLogic_1.trimOps)(list);
    strict_1.default.equal(res.ops.length, oplogLogic_1.MAX_OPS);
    const keptArticles = res.ops.filter((o) => o.entity === 'article').length;
    const keptRecords = res.ops.filter((o) => o.entity === 'practice_record').length;
    strict_1.default.equal(keptArticles, oplogLogic_1.MIN_OTHER_OPS);
    strict_1.default.equal(keptRecords, oplogLogic_1.MAX_OPS - oplogLogic_1.MIN_OTHER_OPS);
    strict_1.default.equal(res.droppedOthers, 500 - oplogLogic_1.MIN_OTHER_OPS);
    strict_1.default.ok(res.droppedRecords > 0);
});
(0, node_test_1.default)('trimOps：非记录类未超配额时保留全部，仅丢最旧记录', () => {
    const list = [...articles(60), ...records(oplogLogic_1.MAX_OPS + 100)];
    const res = (0, oplogLogic_1.trimOps)(list);
    strict_1.default.equal(res.ops.filter((o) => o.entity === 'article').length, 60);
    strict_1.default.equal(res.droppedOthers, 0);
    strict_1.default.equal(res.ops.length, oplogLogic_1.MAX_OPS);
    // 保序：保留的是最新记录
    const keptRecords = res.ops.filter((o) => o.entity === 'practice_record');
    const lastKept = keptRecords[keptRecords.length - 1];
    strict_1.default.ok(lastKept && lastKept.uuid === `r${oplogLogic_1.MAX_OPS + 99}`, '应保留最新的记录类操作');
});
// ============================== 出队 ==============================
(0, node_test_1.default)('filterUnresolved：仅移除 updatedAt 完全一致的已确认操作（避免误删同步期间的新变更）', () => {
    const ops = [op('article', 'a1', 100), op('article', 'a2', 200), op('practice_record', 'r1', 300)];
    const remain = (0, oplogLogic_1.filterUnresolved)(ops, [
        { entity: 'article', uuid: 'a1', updatedAt: 100 }, // 命中 → 出队
        { entity: 'article', uuid: 'a2', updatedAt: 199 }, // 时间戳不一致（期间又改过）→ 保留
    ]);
    strict_1.default.deepEqual(remain.map((o) => o.uuid), ['a2', 'r1']);
});
(0, node_test_1.default)('filterUnresolved：conflict 也按已解决出队（回归：队列永不清空导致死循环）', () => {
    const ops = [op('article', 'a1', 500)];
    const remain = (0, oplogLogic_1.filterUnresolved)(ops, [{ entity: 'article', uuid: 'a1', updatedAt: 500 }]);
    strict_1.default.equal(remain.length, 0);
});
(0, node_test_1.default)('opKey：实体与 uuid 组合，便于跨实体定位', () => {
    strict_1.default.equal((0, oplogLogic_1.opKey)(op('practice_state', 'p1', 1)), 'practice_state:p1');
});
// ============================== oplog 元数据化（存储放大修复） ==============================
(0, node_test_1.default)('toMetaOp：剥离 payload，只保留 entity/op/uuid/updatedAt（回归：oplog 复制整份正文）', () => {
    const heavy = {
        entity: 'article',
        op: 'upsert',
        uuid: 'a1',
        updatedAt: 123,
        payload: { title: '长文', content: 'x'.repeat(50000) },
    };
    const meta = (0, oplogLogic_1.toMetaOp)(heavy);
    strict_1.default.equal(meta.payload, undefined, 'payload 不应再写入 oplog');
    strict_1.default.deepEqual(meta, { entity: 'article', op: 'upsert', uuid: 'a1', updatedAt: 123 });
});
(0, node_test_1.default)('toMetaOp：删除操同样只保留元数据', () => {
    const meta = (0, oplogLogic_1.toMetaOp)({ entity: 'tag', op: 'delete', uuid: 't1', updatedAt: 9, payload: { name: 'x' } });
    strict_1.default.deepEqual(meta, { entity: 'tag', op: 'delete', uuid: 't1', updatedAt: 9 });
});
(0, node_test_1.default)('toMetaOp 结果可直接参与去重/裁剪（不破坏既有逻辑）', () => {
    const ops = [
        (0, oplogLogic_1.toMetaOp)({ entity: 'article', op: 'upsert', uuid: 'a1', updatedAt: 100, payload: { heavy: 'x'.repeat(1000) } }),
        (0, oplogLogic_1.toMetaOp)({ entity: 'article', op: 'upsert', uuid: 'a1', updatedAt: 200, payload: { heavy: 'y'.repeat(1000) } }),
    ];
    const deduped = (0, oplogLogic_1.dedupeOps)(ops);
    strict_1.default.equal(deduped.length, 1);
    strict_1.default.equal(deduped[0].updatedAt, 200);
    strict_1.default.equal((0, oplogLogic_1.trimOps)(deduped).trimmed, 0);
});
