/**
 * oplog（离线同步队列）纯逻辑：去重、裁剪、出队筛选
 *
 * 与 wx / 文件系统解耦，便于 Node 单测（tests/oplog.test.ts）。
 * 设计约束（历史缺陷教训）：
 * - 队列里全部是「尚未同步成功」的待发送操作 → 裁剪必须留痕（触发一次全量快照重排）
 * - 记录类（practice_record）量大且允许丢弃最旧；非记录类（文章/标签/配置）必须保底保留
 */

export interface SyncOpLike {
  entity: string;
  op: 'upsert' | 'delete';
  uuid: string;
  updatedAt: number;
  payload?: unknown;
}

/** 待同步队列上限（防止游客/长期离线场景无限增长） */
export const MAX_OPS = 2000;

/** 非记录类操作的最小保留配额：即使 practice_record 占满上限，也不清空文章/配置类操作 */
export const MIN_OTHER_OPS = 200;

export function opKey(op: { entity: string; uuid: string }): string {
  return `${op.entity}:${op.uuid}`;
}

/**
 * oplog 只保留「元数据」（entity/op/uuid/updatedAt）
 *
 * 载荷（文章正文、练习记录等，单条可达数十 KB）在推送前从本地存储按 (entity, uuid) 解析，
 * 因此不需要在 oplog 里再复制一份——否则本地文件会成倍膨胀（旧版本遗留的 payload 会在装载时被剥离）。
 */
export function toMetaOp<T extends SyncOpLike>(op: T): Omit<T, 'payload'> {
  const { entity, op: kind, uuid, updatedAt } = op;
  return { entity, op: kind, uuid, updatedAt } as Omit<T, 'payload'>;
}

/** 去除同一实体的历史版本，仅保留最新一条（后写覆盖先写），返回按 updatedAt 升序 */
export function dedupeOps<T extends SyncOpLike>(ops: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const op of ops) byKey.set(opKey(op), op);
  return Array.from(byKey.values()).sort((a, b) => a.updatedAt - b.updatedAt);
}

export interface TrimResult<T> {
  ops: T[];
  trimmed: number;
  /** 被丢弃的非记录类操作数：> 0 时必须安排一次全量快照对齐（否则云端永久缺这些变更） */
  droppedOthers: number;
  /** 被丢弃的记录类操作数（设计允许：旧练习记录仅本地保留） */
  droppedRecords: number;
}

/** 裁剪到上限：记录类优先丢弃，但非记录类保留 MIN_OTHER_OPS 条兜底 */
export function trimOps<T extends SyncOpLike>(
  ops: T[],
  max = MAX_OPS,
  minOther = MIN_OTHER_OPS
): TrimResult<T> {
  if (ops.length <= max) return { ops, trimmed: 0, droppedOthers: 0, droppedRecords: 0 };
  const others = ops.filter((o) => o.entity !== 'practice_record');
  const records = ops.filter((o) => o.entity === 'practice_record');
  const keepOthers = Math.min(others.length, Math.max(minOther, max - records.length));
  const keepRecords = Math.min(records.length, max - keepOthers);
  const kept = [
    ...others.slice(others.length - keepOthers),
    ...records.slice(records.length - keepRecords),
  ].sort((a, b) => a.updatedAt - b.updatedAt);
  return {
    ops: kept,
    trimmed: ops.length - kept.length,
    droppedOthers: others.length - keepOthers,
    droppedRecords: records.length - keepRecords,
  };
}

export interface ResolvedRef {
  entity: string;
  uuid: string;
  updatedAt: number;
}

/**
 * 出队：移除已确认（服务端 applied / conflict 判定完成）且**仍是队列中最新一次变更**的操作。
 * - 用 updatedAt 严格比对，避免同步期间产生的新变更被误删
 * - conflict 也视为已解决：服务端版本胜出，随后的 pull 会对齐本地
 */
export function filterUnresolved<T extends SyncOpLike>(ops: T[], resolved: ResolvedRef[]): T[] {
  const byKey = new Map(resolved.map((r) => [opKey(r), r.updatedAt]));
  return ops.filter((o) => {
    const at = byKey.get(opKey(o));
    if (at === undefined) return true;
    return at !== o.updatedAt;
  });
}