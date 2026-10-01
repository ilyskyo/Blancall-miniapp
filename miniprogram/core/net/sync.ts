/**
 * 云同步引擎（核心学习数据）
 *
 * 协议：POST /sync/push（实体级 LWW）+ GET /sync/pull?cursor=（增量拉取）
 * 触发：登录后首次全量；应用启动；关键写操作后防抖；onHide；手动
 */

import { SyncPullResult, SyncPushResult } from './api';
import { isLoggedIn } from '../storage/prefs';
import { ackOps, pushOp, peekOps, SyncEntity, SyncOp, SyncableRecord } from '../storage/collection';
import { cloud, cloudErrorText } from './cloud';
import {
  articleStore,
  customClozeStore,
  fsrsStore,
  homeLayoutStore,
  maskConfigStore,
  practiceStateStore,
  readerPrefsStore,
  recordStore,
  studyStatStore,
  tagLinkStore,
  tagStore,
} from '../storage/entities';
import { getSettings, getSyncCursor, getDeviceId, needsFullResync, setDeviceId, setNeedsFullResync, setSyncCursor, updateSettings } from '../storage/prefs';
import { newDeviceId } from '../utils/uuid';
import { emit, EVT } from '../store/bus';

interface Mergeable {
  mergeRemote(remote: Array<{ uuid: string; op: 'upsert' | 'delete'; updatedAt: number; payload?: unknown }>): number;
}

type PullItem = SyncPullResult['items'][number];

function registry(): Record<string, Mergeable> {
  return {
    article: articleStore as unknown as Mergeable,
    tag: tagStore as unknown as Mergeable,
    tag_link: tagLinkStore as unknown as Mergeable,
    practice_record: recordStore as unknown as Mergeable,
    practice_state: practiceStateStore as unknown as Mergeable,
    fsrs: fsrsStore as unknown as Mergeable,
    custom_cloze: customClozeStore as unknown as Mergeable,
    mask_config: maskConfigStore as unknown as Mergeable,
    reader_prefs: readerPrefsStore as unknown as Mergeable,
    home_layout: homeLayoutStore as unknown as Mergeable,
    study_stat: studyStatStore as unknown as Mergeable,
  };
}

const BATCH = 200;

/**
 * 推送载荷解析：oplog 只存元数据，推送前按 (entity, uuid) 从本地存储取最新实体。
 * 好处：本地 oplog 不再复制整份正文/记录（存储与写放大显著降低）。
 * 每轮只对批次里出现的实体做一次全量遍历，构建 uuid → 实体 的字典。
 */
function makePayloadResolver(batch: SyncOp[]): (op: SyncOp) => unknown {
  const needed = new Map<SyncEntity, Set<string>>();
  for (const op of batch) {
    if (op.op !== 'upsert') continue; // 墓碑不需要载荷
    const set = needed.get(op.entity) || new Set<string>();
    set.add(op.uuid);
    needed.set(op.entity, set);
  }
  const dict = new Map<string, unknown>();
  needed.forEach((uuids, entity) => {
    if (entity === 'app_settings') {
      dict.set('app_settings:me', getSettings());
      return;
    }
    for (const item of itemsOfEntity(entity)) {
      const uuid = (item as { uuid?: string }).uuid;
      if (uuid && uuids.has(uuid)) dict.set(`${entity}:${uuid}`, item);
    }
  });
  return (op: SyncOp) => (op.op === 'delete' ? undefined : dict.get(`${op.entity}:${op.uuid}`));
}

/** 本地实体清单（用于推送前解析载荷） */
function itemsOfEntity(entity: SyncEntity): Array<{ uuid: string }> {
  switch (entity) {
    case 'article':
      return articleStore.list();
    case 'tag':
      return tagStore.list();
    case 'tag_link':
      return tagLinkStore.list();
    case 'practice_record':
      return recordStore.list();
    case 'practice_state':
      return practiceStateStore.list();
    case 'fsrs':
      return fsrsStore.list();
    case 'custom_cloze':
      return customClozeStore.list();
    case 'mask_config':
      return maskConfigStore.list();
    case 'reader_prefs':
      return readerPrefsStore.list();
    case 'home_layout':
      return homeLayoutStore.list();
    case 'study_stat':
      return studyStatStore.list();
    default:
      // sentence_card 仅本地，不入队
      return [];
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  cursor: string;
  error?: string;
}

let syncing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 立即同步（push → pull 循环至 hasMore=false） */
export async function syncNow(options: { silent?: boolean } = {}): Promise<SyncResult> {
  if (!isLoggedIn()) return { pushed: 0, pulled: 0, cursor: getSyncCursor(), error: '未登录' };
  if (syncing) return { pushed: 0, pulled: 0, cursor: getSyncCursor(), error: '正在同步' };
  syncing = true;

  let pushed = 0;
  let pulled = 0;
  let cursor = getSyncCursor();
  try {
    // ---- 裁剪留痕：先做一次本地全量快照，把此前被丢弃的非记录类变更重新入队 ----
    if (needsFullResync()) {
      await enqueueFullSnapshot();
      setNeedsFullResync(false);
      console.warn('[sync] 检测到 oplog 曾超限裁剪，已执行本地全量快照对齐');
    }

    // ---- push ----
    let ops = peekOps();
    while (ops.length > 0) {
      const batchOps = ops.slice(0, BATCH);
      // oplog 只存元数据：推送前解析最新载荷（删除操作为墓碑，不带载荷）
      const resolvePayload = makePayloadResolver(batchOps);
      const batch = batchOps.map((o) => ({ ...o, payload: resolvePayload(o) }));
      const res = await cloudPush(batch, ensureDeviceId());
      // 响应只有 uuid/status（不含 entity）→ 从本批 op 反查 entity 与 updatedAt
      // applied 与 conflict 都算已解决：conflict 表示服务端版本胜出，随后的 pull 会对齐本地
      const byUuid = new Map(batchOps.map((o) => [o.uuid, o] as const));
      const resolved = res.results
        .filter((r) => r.status === 'applied' || r.status === 'conflict')
        .map((r) => byUuid.get(r.uuid))
        .filter((o): o is SyncOp => !!o)
        .map((o) => ({ entity: o.entity, uuid: o.uuid, updatedAt: o.updatedAt }));
      const beforeAck = ops.length;
      ackOps(resolved);
      pushed += batch.length;
      ops = peekOps();
      // 零进展保护：一轮下来没有任何 op 出队（例如全部被服务端拒绝）→ 立即退出，避免死循环
      if (ops.length >= beforeAck) {
        console.warn('[sync] 本轮推送没有任何操作出队，已暂停推送以避免死循环');
        break;
      }
      if (batch.length < BATCH) break;
    }

    // ---- pull ----
    const reg = registry();
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard < 40) {
      guard++;
      const res: SyncPullResult = await cloudPull(cursor, 500);
      const byEntity = new Map<string, PullItem[]>();
      for (const item of res.items) {
        const list = byEntity.get(item.entity) || [];
        list.push(item);
        byEntity.set(item.entity, list);
      }
      byEntity.forEach((items, entity) => {
        if (entity === 'app_settings') {
          applyRemoteSettings(items);
          return;
        }
        const target = reg[entity];
        if (target) {
          const n = target.mergeRemote(items.map((it) => ({ uuid: it.uuid, op: it.op, updatedAt: it.updatedAt, payload: it.payload })));
          pulled += n;
        }
      });
      cursor = res.nextCursor;
      setSyncCursor(cursor);
      hasMore = res.hasMore;
    }

    emit(EVT.syncFinished, { pushed, pulled, at: Date.now() });
    return { pushed, pulled, cursor };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!options.silent) console.error('[sync] 失败', e);
    return { pushed, pulled, cursor, error: message };
  } finally {
    syncing = false;
  }
}

/** 关键写操作后调用（防抖 6s），避免频繁请求 */
export function scheduleSync(delay = 6000): void {
  if (!isLoggedIn()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow({ silent: true });
  }, delay);
}

/** 首次登录后全量对齐：上传本地全部实体 + 拉取云端 */
export async function firstSyncAfterLogin(): Promise<SyncResult> {
  await enqueueFullSnapshot();
  return syncNow();
}

/** 把当前全部本地数据放入待同步队列（用于登录前产生的本地数据 / 裁剪后重排）
 *  只入队元数据，载荷在推送时解析，避免为全量快照复制整份正文 */
export async function enqueueFullSnapshot(): Promise<void> {
  const pushAll = <T extends SyncableRecord>(entity: SyncEntity, items: T[]) => {
    for (const item of items) {
      enqueue({ entity, op: 'upsert', uuid: item.uuid, updatedAt: item.updatedAt || Date.now() });
    }
  };
  pushAll('article', articleStore.list());
  pushAll('tag', tagStore.list());
  pushAll('tag_link', tagLinkStore.list());
  pushAll('practice_record', recordStore.list());
  pushAll('practice_state', practiceStateStore.list());
  pushAll('fsrs', fsrsStore.list());
  pushAll('custom_cloze', customClozeStore.list());
  pushAll('mask_config', maskConfigStore.list());
  pushAll('reader_prefs', readerPrefsStore.list());
  pushAll('home_layout', homeLayoutStore.list());
  pushAll('study_stat', studyStatStore.list());
  // 设置（同样只入队元数据，推送时取 getSettings()）
  enqueue({
    entity: 'app_settings',
    op: 'upsert',
    uuid: 'me',
    updatedAt: Date.now(),
  });
}

function applyRemoteSettings(items: PullItem[]): void {
  const latest = items
    .filter((it) => it.op === 'upsert' && it.payload)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .pop();
  if (!latest || !latest.payload) return;
  const remote = latest.payload as Record<string, unknown>;
  const local = getSettings() as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...local };
  for (const key of Object.keys(remote)) {
    // 本地偏外观类键以本地优先（多端各自外观），其余以云端为准
    const localOnly = ['themeMode', 'lightBackground', 'accentColor', 'subtitle', 'navLiquidGlass'];
    if (localOnly.includes(key)) continue;
    merged[key] = remote[key];
  }
  updateSettings(merged as never);
}

// 避免循环依赖：oplog 入队封装
function enqueue(op: SyncOp): void {
  pushOp(op);
}

function ensureDeviceId(): string {
  const cur = getDeviceId();
  if (cur) return cur;
  const id = newDeviceId();
  setDeviceId(id);
  return id;
}

/** 同步状态（供 UI 展示） */
export function isSyncing(): boolean {
  return syncing;
}

// ============================== 云传输（WorkBuddy 云服务） ==============================

type PushOp = { entity: string; op: 'upsert' | 'delete'; uuid: string; updatedAt: number; payload?: unknown };

/** 实体级 LWW 推送（RPC sync_push_batch；RLS 限定本人数据） */
async function cloudPush(ops: PushOp[], deviceId: string): Promise<SyncPushResult> {
  const { data, error } = await cloud().database.rpc('sync_push_batch', {
    p_ops: ops as unknown as Array<Record<string, unknown>>,
    p_device_id: deviceId,
  });
  if (error) throw new Error(cloudErrorText(error));
  const arr = (Array.isArray(data) ? data : []) as Array<{ uuid: string; status: 'applied' | 'conflict' }>;
  const entityByUuid = new Map(ops.map((o) => [o.uuid, o.entity] as const));
  return {
    results: arr.map((r) => ({
      entity: entityByUuid.get(r.uuid) || '',
      uuid: r.uuid,
      status: r.status === 'conflict' ? 'conflict' : 'applied',
      rev: 0,
      serverUpdatedAt: Date.now(),
    })),
    serverTime: Date.now(),
  };
}

/** 增量拉取（seq 单调游标；返回混合实体的有序流） */
async function cloudPull(cursor: string, limit: number): Promise<SyncPullResult> {
  let query = cloud()
    .database.from('sync_data')
    .select('entity,id,op,payload,updated_at,seq')
    .order('seq', { ascending: true })
    .limit(limit);
  const seq = Number(cursor);
  if (Number.isFinite(seq) && seq > 0) query = query.gt('seq', seq);
  const { data, error } = await query;
  if (error) throw new Error(cloudErrorText(error));
  const rows = (data || []) as Array<{ entity: string; id: string; op: string; payload: unknown; updated_at: number; seq: number }>;
  const items = rows.map((r) => ({
    entity: r.entity,
    uuid: r.id,
    op: r.op === 'delete' ? ('delete' as const) : ('upsert' as const),
    updatedAt: Number(r.updated_at),
    payload: r.payload,
    rev: Number(r.seq),
  }));
  const nextCursor = rows.length > 0 ? String(rows[rows.length - 1].seq) : cursor;
  return { items, nextCursor, hasMore: rows.length >= limit };
}

