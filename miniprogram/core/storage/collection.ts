/**
 * 集合存储与同步操作日志（oplog）
 *
 * 设计：
 * - 每个实体一个 JSON 文件（全量重写，原子写），内存缓存 + 变更即落盘
 * - 记录类（practice_record）用 JSONL 追加，避免全量重写
 * - 任何写操作都追加一条 oplog（离线队列），云同步成功后清空
 */

import { DB_DIR, appendLine, readJson, readText, writeJson, removeFile, ensureDir, writeTextAtomic } from './fs';
import { dedupeOps, filterUnresolved, toMetaOp, trimOps } from './oplogLogic';
import { isLoggedIn, setNeedsFullResync } from './prefs';

/** 可同步实体（对应服务端 entities.entity） */
export type SyncEntity =
  | 'article'
  | 'tag'
  | 'tag_link'
  | 'practice_record'
  | 'practice_state'
  | 'fsrs'
  | 'custom_cloze'
  | 'mask_config'
  | 'reader_prefs'
  | 'home_layout'
  | 'app_settings'
  | 'study_stat'
  /** 每日句卡：仅本地（不参与云同步，无 oplog） */
  | 'sentence_card';

export interface SyncableRecord {
  uuid: string;
  /** 记录类实体（如 practice_record）用自身时间戳作为版本时间 */
  updatedAt?: number;
}

/** 取实体版本时间（缺省回退 timestamp / 当前时间） */
export function recordVersion(item: unknown): number {
  const o = item as { updatedAt?: number; timestamp?: number; lastPracticeTime?: number; createdAt?: number };
  return o.updatedAt || o.timestamp || o.lastPracticeTime || o.createdAt || Date.now();
}

export interface SyncOp {
  entity: SyncEntity;
  op: 'upsert' | 'delete';
  uuid: string;
  updatedAt: number;
  payload?: unknown;
}

const OPLOG_FILE = `${DB_DIR}/sync/oplog.jsonl`;

// ============================== oplog ==============================

let pendingOps: SyncOp[] | null = null;

function loadOps(): SyncOp[] {
  if (pendingOps) return pendingOps;
  const raw = readText(OPLOG_FILE) || '';
  const parsed: SyncOp[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      // 只保留元数据：旧版本遗留的 payload（整份实体）会在装载时被剥离，下次重写即回收空间
      parsed.push(toMetaOp(JSON.parse(t) as SyncOp));
    } catch {
      /* 跳过坏行 */
    }
  }
  // 文件是追加写，可能残留同一实体的历史版本行 → 装载时按 entity:uuid 保留最新
  pendingOps = dedupeOps(parsed);
  return pendingOps;
}

/**
 * 待同步队列上限：超出后按优先级丢弃最旧的操作，防止「永久游客 / 长期离线」
 * 场景下 oplog 无限增长（曾出现的缺陷：每次写操作都追加，超限后整文件重写 O(n)）。
 *
 * 丢弃策略（见 core/storage/oplogLogic.ts）：
 * 1) 非记录类（文章/标签/配置）至少保留 MIN_OTHER_OPS 条
 * 2) 记录类（practice_record）保序保留最新
 * 3) 一旦丢弃了非记录类操作，置「需要全量重排」标记 → 下次同步前做一次本地全量快照，
 *    避免这些变更永久缺同步（历史缺陷：裁剪后已登录用户没有任何补回机制）
 */
export function pushOp(op: SyncOp): void {
  const ops = loadOps();
  // 只入队元数据：载荷在推送时按 (entity, uuid) 从本地存储解析（避免 oplog 复制整份正文）
  const meta = toMetaOp(op);
  ops.push(meta);
  // 同实体同 uuid 只保留最后一条（减少同步量）
  const { ops: kept, trimmed, droppedOthers } = trimOps(dedupeOps(ops));
  pendingOps = kept;
  appendLine(OPLOG_FILE, JSON.stringify(meta));
  if (trimmed > 0) {
    // 仅在发生裁剪时重写（平时保持 O(1) 追加）
    console.warn(`[oplog] 队列超限，已丢弃 ${trimmed} 条最旧操作（非记录类 ${droppedOthers} 条）`);
    if (droppedOthers > 0) setNeedsFullResync(true);
    rewriteOps();
  }
}

function rewriteOps(): void {
  const ops = pendingOps || [];
  const body = ops.map((o) => JSON.stringify(o)).join('\n');
  writeJson(`${DB_DIR}/sync/oplog.json`, ops); // 备份快照
  try {
    writeTextAtomic(OPLOG_FILE, body ? `${body}\n` : '');
  } catch {
    /* 忽略 */
  }
}

/** 待同步操作（全量） */
export function peekOps(): SyncOp[] {
  return loadOps().slice();
}

/**
 * 同步成功后移除已确认的操作（applied / conflict 都已解决）
 * - 只移除"仍然是最新一次变更"的操作，避免丢失期间产生的新变更
 * - 队列清空时直接删除文件（避免残留空文件）
 */
export function ackOps(applied: Array<{ entity: SyncEntity; uuid: string; updatedAt: number }>): void {
  const remain = filterUnresolved(loadOps(), applied);
  pendingOps = remain;
  if (remain.length === 0) {
    removeFile(OPLOG_FILE);
    removeFile(`${DB_DIR}/sync/oplog.json`);
    return;
  }
  rewriteOps();
}

/** 清空 oplog（首次全量对齐用） */
export function clearOps(): void {
  pendingOps = [];
  removeFile(OPLOG_FILE);
}

export function hasPendingOps(): boolean {
  return loadOps().length > 0;
}

// ============================== JSON 集合 ==============================

export class JsonCollection<T extends SyncableRecord> {
  private items: T[] = [];
  private loaded = false;
  /**
   * 写入版本号：任何落盘变更都会 +1。
   * 供上层构建"按文章索引"等缓存时判断失效，避免每个调用方各自扫描全量集合。
   */
  private rev = 0;

  constructor(private readonly file: string, private readonly entity: SyncEntity) {}

  /** 当前写入版本（只读） */
  revision(): number {
    return this.rev;
  }

  private load(): void {
    if (this.loaded) return;
    this.items = readJson<T[]>(this.file, []);
    if (!Array.isArray(this.items)) this.items = [];
    this.loaded = true;
  }

  list(): T[] {
    this.load();
    return this.items.slice();
  }

  find(uuid: string): T | undefined {
    this.load();
    return this.items.find((it) => it.uuid === uuid);
  }

  count(): number {
    this.load();
    return this.items.length;
  }

  /** 新增或更新（保持排序稳定：更新原位替换） */
  upsert(item: T, opts: { silent?: boolean } = {}): void {
    this.load();
    const idx = this.items.findIndex((it) => it.uuid === item.uuid);
    if (idx >= 0) this.items[idx] = item;
    else this.items.push(item);
    this.persist();
    if (!opts.silent) pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
  }

  /** 批量 upsert（不逐条写盘） */
  upsertMany(items: T[], opts: { silent?: boolean } = {}): void {
    this.load();
    for (const item of items) {
      const idx = this.items.findIndex((it) => it.uuid === item.uuid);
      if (idx >= 0) this.items[idx] = item;
      else this.items.push(item);
    }
    this.persist();
    if (!opts.silent) {
      for (const item of items) {
        pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
      }
    }
  }

  remove(uuid: string, opts: { silent?: boolean } = {}): void {
    this.load();
    const before = this.items.length;
    this.items = this.items.filter((it) => it.uuid !== uuid);
    if (this.items.length === before) return;
    this.persist();
    if (!opts.silent) {
      pushOp({ entity: this.entity, op: 'delete', uuid, updatedAt: Date.now() });
    }
  }

  /** 云端拉取合并：按 updatedAt 做 LWW */
  mergeRemote(remote: Array<{ uuid: string; op: 'upsert' | 'delete'; updatedAt: number; payload?: unknown }>): number {
    this.load();
    let applied = 0;
    for (const r of remote) {
      const idx = this.items.findIndex((it) => it.uuid === r.uuid);
      if (r.op === 'delete') {
        if (idx >= 0 && recordVersion(this.items[idx]) <= r.updatedAt) {
          this.items.splice(idx, 1);
          applied++;
        }
        continue;
      }
      const incoming = r.payload as T;
      if (!incoming) continue;
      if (idx < 0) {
        this.items.push(incoming);
        applied++;
      } else if (recordVersion(incoming) >= recordVersion(this.items[idx])) {
        this.items[idx] = incoming;
        applied++;
      }
    }
    if (applied > 0) this.persist();
    return applied;
  }

  /** 整表替换（导入备份用） */
  replaceAll(items: T[], opts: { silent?: boolean } = {}): void {
    this.load();
    this.items = items.slice();
    this.persist();
    if (!opts.silent) {
      for (const item of items) {
        pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
      }
    }
  }

  private persist(): void {
    ensureDir(DB_DIR);
    writeJson(this.file, this.items);
    this.rev += 1;
  }
}

// ============================== JSONL 集合（追加写） ==============================

export class JsonlCollection<T extends SyncableRecord> {
  private items: T[] = [];
  private loaded = false;
  /** 写入版本号（追加/删除/整表替换都会 +1），供上层索引缓存失效判断 */
  private rev = 0;

  constructor(private readonly file: string, private readonly entity: SyncEntity) {}

  /** 当前写入版本（只读） */
  revision(): number {
    return this.rev;
  }

  private load(): void {
    if (this.loaded) return;
    const raw = readText(this.file) || '';
    const out: T[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as T);
      } catch {
        /* 跳过坏行 */
      }
    }
    this.items = out;
    this.loaded = true;
  }

  list(): T[] {
    this.load();
    return this.items.slice();
  }

  append(item: T): void {
    this.load();
    this.items.push(item);
    ensureDir(DB_DIR);
    appendLine(this.file, JSON.stringify(item));
    this.rev += 1;
    pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
  }

  removeBy(pred: (it: T) => boolean): number {
    this.load();
    const remain = this.items.filter((it) => !pred(it));
    const removed = this.items.length - remain.length;
    if (removed > 0) {
      this.items = remain;
      this.rev += 1;
      const body = this.items.map((it) => JSON.stringify(it)).join('\n');
      writeJson(`${this.file}.json`, this.items);
      try {
        writeTextAtomic(this.file, body ? `${body}\n` : '');
      } catch {
        /* 忽略 */
      }
    }
    return removed;
  }

  replaceAll(items: T[], opts: { silent?: boolean } = {}): void {
    this.load();
    this.items = items.slice();
    this.rev += 1;
    const body = this.items.map((it) => JSON.stringify(it)).join('\n');
    writeJson(`${this.file}.json`, this.items);
    try {
      writeTextAtomic(this.file, body ? `${body}\n` : '');
    } catch {
      /* 忽略 */
    }
    if (!opts.silent) {
      for (const item of items) {
        pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
      }
    }
  }

  mergeRemote(remote: Array<{ uuid: string; op: 'upsert' | 'delete'; updatedAt: number; payload?: unknown }>): number {
    this.load();
    const map = new Map(this.items.map((it) => [it.uuid, it] as const));
    let applied = 0;
    for (const r of remote) {
      if (r.op === 'delete') {
        if (map.delete(r.uuid)) applied++;
        continue;
      }
      const incoming = r.payload as T;
      if (!incoming) continue;
      const cur = map.get(r.uuid);
      if (!cur || recordVersion(incoming) >= recordVersion(cur)) {
        map.set(r.uuid, incoming);
        applied++;
      }
    }
    if (applied > 0) this.replaceAll(Array.from(map.values()), { silent: true });
    return applied;
  }
}

/** 是否应记录同步日志（未登录也记录，登录后补传） */
export function trackSync(): boolean {
  // 目前始终记录；保留钩子以便后续在"确定不用云同步"的用户上关闭
  return isLoggedIn() || true;
}