import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeOps,
  filterUnresolved,
  MAX_OPS,
  MIN_OTHER_OPS,
  opKey,
  SyncOpLike,
  toMetaOp,
  trimOps,
} from '../core/storage/oplogLogic';

function op(entity: string, uuid: string, updatedAt: number): SyncOpLike {
  return { entity, op: 'upsert', uuid, updatedAt };
}

function records(n: number, base = 0): SyncOpLike[] {
  return Array.from({ length: n }, (_, i) => op('practice_record', `r${base + i}`, 1000 + i));
}

function articles(n: number, base = 0): SyncOpLike[] {
  return Array.from({ length: n }, (_, i) => op('article', `a${base + i}`, 1000 + i));
}

// ============================== 去重 ==============================

test('dedupeOps：同一实体只保留最新一条，并按 updatedAt 升序', () => {
  const list = [op('article', 'a1', 300), op('article', 'a1', 100), op('article', 'a1', 200)];
  const out = dedupeOps(list);
  assert.equal(out.length, 1);
  assert.equal(out[0].updatedAt, 200);
});

test('dedupeOps：不同实体同 uuid 互不覆盖', () => {
  const out = dedupeOps([op('article', 'x', 1), op('tag', 'x', 2)]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(opKey), ['article:x', 'tag:x']);
});

// ============================== 裁剪 ==============================

test('trimOps：未超限不裁剪', () => {
  const list = articles(10);
  const res = trimOps(list);
  assert.equal(res.trimmed, 0);
  assert.equal(res.ops.length, 10);
  assert.equal(res.droppedOthers, 0);
});

test('trimOps：记录类占满上限时仍保留非记录类最小配额（回归：曾把文章/配置全部丢弃）', () => {
  const list = [...articles(500), ...records(MAX_OPS + 300)];
  const res = trimOps(list);
  assert.equal(res.ops.length, MAX_OPS);
  const keptArticles = res.ops.filter((o) => o.entity === 'article').length;
  const keptRecords = res.ops.filter((o) => o.entity === 'practice_record').length;
  assert.equal(keptArticles, MIN_OTHER_OPS);
  assert.equal(keptRecords, MAX_OPS - MIN_OTHER_OPS);
  assert.equal(res.droppedOthers, 500 - MIN_OTHER_OPS);
  assert.ok(res.droppedRecords > 0);
});

test('trimOps：非记录类未超配额时保留全部，仅丢最旧记录', () => {
  const list = [...articles(60), ...records(MAX_OPS + 100)];
  const res = trimOps(list);
  assert.equal(res.ops.filter((o) => o.entity === 'article').length, 60);
  assert.equal(res.droppedOthers, 0);
  assert.equal(res.ops.length, MAX_OPS);
  // 保序：保留的是最新记录
  const keptRecords = res.ops.filter((o) => o.entity === 'practice_record');
  const lastKept = keptRecords[keptRecords.length - 1];
  assert.ok(lastKept && lastKept.uuid === `r${MAX_OPS + 99}`, '应保留最新的记录类操作');
});

// ============================== 出队 ==============================

test('filterUnresolved：仅移除 updatedAt 完全一致的已确认操作（避免误删同步期间的新变更）', () => {
  const ops = [op('article', 'a1', 100), op('article', 'a2', 200), op('practice_record', 'r1', 300)];
  const remain = filterUnresolved(ops, [
    { entity: 'article', uuid: 'a1', updatedAt: 100 }, // 命中 → 出队
    { entity: 'article', uuid: 'a2', updatedAt: 199 }, // 时间戳不一致（期间又改过）→ 保留
  ]);
  assert.deepEqual(remain.map((o) => o.uuid), ['a2', 'r1']);
});

test('filterUnresolved：conflict 也按已解决出队（回归：队列永不清空导致死循环）', () => {
  const ops = [op('article', 'a1', 500)];
  const remain = filterUnresolved(ops, [{ entity: 'article', uuid: 'a1', updatedAt: 500 }]);
  assert.equal(remain.length, 0);
});

test('opKey：实体与 uuid 组合，便于跨实体定位', () => {
  assert.equal(opKey(op('practice_state', 'p1', 1)), 'practice_state:p1');
});

// ============================== oplog 元数据化（存储放大修复） ==============================

test('toMetaOp：剥离 payload，只保留 entity/op/uuid/updatedAt（回归：oplog 复制整份正文）', () => {
  const heavy: SyncOpLike = {
    entity: 'article',
    op: 'upsert',
    uuid: 'a1',
    updatedAt: 123,
    payload: { title: '长文', content: 'x'.repeat(50000) },
  };
  const meta = toMetaOp(heavy);
  assert.equal((meta as { payload?: unknown }).payload, undefined, 'payload 不应再写入 oplog');
  assert.deepEqual(meta, { entity: 'article', op: 'upsert', uuid: 'a1', updatedAt: 123 });
});

test('toMetaOp：删除操同样只保留元数据', () => {
  const meta = toMetaOp({ entity: 'tag', op: 'delete', uuid: 't1', updatedAt: 9, payload: { name: 'x' } });
  assert.deepEqual(meta, { entity: 'tag', op: 'delete', uuid: 't1', updatedAt: 9 });
});

test('toMetaOp 结果可直接参与去重/裁剪（不破坏既有逻辑）', () => {
  const ops = [
    toMetaOp({ entity: 'article', op: 'upsert', uuid: 'a1', updatedAt: 100, payload: { heavy: 'x'.repeat(1000) } }),
    toMetaOp({ entity: 'article', op: 'upsert', uuid: 'a1', updatedAt: 200, payload: { heavy: 'y'.repeat(1000) } }),
  ];
  const deduped = dedupeOps(ops);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].updatedAt, 200);
  assert.equal(trimOps(deduped).trimmed, 0);
});