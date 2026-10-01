"use strict";
/**
 * 集合存储与同步操作日志（oplog）
 *
 * 设计：
 * - 每个实体一个 JSON 文件（全量重写，原子写），内存缓存 + 变更即落盘
 * - 记录类（practice_record）用 JSONL 追加，避免全量重写
 * - 任何写操作都追加一条 oplog（离线队列），云同步成功后清空
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackSync = exports.JsonlCollection = exports.JsonCollection = exports.hasPendingOps = exports.clearOps = exports.ackOps = exports.peekOps = exports.pushOp = exports.recordVersion = void 0;
const fs_1 = require("./fs");
const oplogLogic_1 = require("./oplogLogic");
const prefs_1 = require("./prefs");
/** 取实体版本时间（缺省回退 timestamp / 当前时间） */
function recordVersion(item) {
    const o = item;
    return o.updatedAt || o.timestamp || o.lastPracticeTime || o.createdAt || Date.now();
}
exports.recordVersion = recordVersion;
const OPLOG_FILE = `${fs_1.DB_DIR}/sync/oplog.jsonl`;
// ============================== oplog ==============================
let pendingOps = null;
function loadOps() {
    if (pendingOps)
        return pendingOps;
    const raw = (0, fs_1.readText)(OPLOG_FILE) || '';
    const parsed = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            // 只保留元数据：旧版本遗留的 payload（整份实体）会在装载时被剥离，下次重写即回收空间
            parsed.push((0, oplogLogic_1.toMetaOp)(JSON.parse(t)));
        }
        catch {
            /* 跳过坏行 */
        }
    }
    // 文件是追加写，可能残留同一实体的历史版本行 → 装载时按 entity:uuid 保留最新
    pendingOps = (0, oplogLogic_1.dedupeOps)(parsed);
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
function pushOp(op) {
    const ops = loadOps();
    // 只入队元数据：载荷在推送时按 (entity, uuid) 从本地存储解析（避免 oplog 复制整份正文）
    const meta = (0, oplogLogic_1.toMetaOp)(op);
    ops.push(meta);
    // 同实体同 uuid 只保留最后一条（减少同步量）
    const { ops: kept, trimmed, droppedOthers } = (0, oplogLogic_1.trimOps)((0, oplogLogic_1.dedupeOps)(ops));
    pendingOps = kept;
    (0, fs_1.appendLine)(OPLOG_FILE, JSON.stringify(meta));
    if (trimmed > 0) {
        // 仅在发生裁剪时重写（平时保持 O(1) 追加）
        console.warn(`[oplog] 队列超限，已丢弃 ${trimmed} 条最旧操作（非记录类 ${droppedOthers} 条）`);
        if (droppedOthers > 0)
            (0, prefs_1.setNeedsFullResync)(true);
        rewriteOps();
    }
}
exports.pushOp = pushOp;
function rewriteOps() {
    const ops = pendingOps || [];
    const body = ops.map((o) => JSON.stringify(o)).join('\n');
    (0, fs_1.writeJson)(`${fs_1.DB_DIR}/sync/oplog.json`, ops); // 备份快照
    try {
        (0, fs_1.writeTextAtomic)(OPLOG_FILE, body ? `${body}\n` : '');
    }
    catch {
        /* 忽略 */
    }
}
/** 待同步操作（全量） */
function peekOps() {
    return loadOps().slice();
}
exports.peekOps = peekOps;
/**
 * 同步成功后移除已确认的操作（applied / conflict 都已解决）
 * - 只移除"仍然是最新一次变更"的操作，避免丢失期间产生的新变更
 * - 队列清空时直接删除文件（避免残留空文件）
 */
function ackOps(applied) {
    const remain = (0, oplogLogic_1.filterUnresolved)(loadOps(), applied);
    pendingOps = remain;
    if (remain.length === 0) {
        (0, fs_1.removeFile)(OPLOG_FILE);
        (0, fs_1.removeFile)(`${fs_1.DB_DIR}/sync/oplog.json`);
        return;
    }
    rewriteOps();
}
exports.ackOps = ackOps;
/** 清空 oplog（首次全量对齐用） */
function clearOps() {
    pendingOps = [];
    (0, fs_1.removeFile)(OPLOG_FILE);
}
exports.clearOps = clearOps;
function hasPendingOps() {
    return loadOps().length > 0;
}
exports.hasPendingOps = hasPendingOps;
// ============================== JSON 集合 ==============================
class JsonCollection {
    constructor(file, entity) {
        this.file = file;
        this.entity = entity;
        this.items = [];
        this.loaded = false;
        /**
         * 写入版本号：任何落盘变更都会 +1。
         * 供上层构建"按文章索引"等缓存时判断失效，避免每个调用方各自扫描全量集合。
         */
        this.rev = 0;
    }
    /** 当前写入版本（只读） */
    revision() {
        return this.rev;
    }
    load() {
        if (this.loaded)
            return;
        this.items = (0, fs_1.readJson)(this.file, []);
        if (!Array.isArray(this.items))
            this.items = [];
        this.loaded = true;
    }
    list() {
        this.load();
        return this.items.slice();
    }
    find(uuid) {
        this.load();
        return this.items.find((it) => it.uuid === uuid);
    }
    count() {
        this.load();
        return this.items.length;
    }
    /** 新增或更新（保持排序稳定：更新原位替换） */
    upsert(item, opts = {}) {
        this.load();
        const idx = this.items.findIndex((it) => it.uuid === item.uuid);
        if (idx >= 0)
            this.items[idx] = item;
        else
            this.items.push(item);
        this.persist();
        if (!opts.silent)
            pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
    }
    /** 批量 upsert（不逐条写盘） */
    upsertMany(items, opts = {}) {
        this.load();
        for (const item of items) {
            const idx = this.items.findIndex((it) => it.uuid === item.uuid);
            if (idx >= 0)
                this.items[idx] = item;
            else
                this.items.push(item);
        }
        this.persist();
        if (!opts.silent) {
            for (const item of items) {
                pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
            }
        }
    }
    remove(uuid, opts = {}) {
        this.load();
        const before = this.items.length;
        this.items = this.items.filter((it) => it.uuid !== uuid);
        if (this.items.length === before)
            return;
        this.persist();
        if (!opts.silent) {
            pushOp({ entity: this.entity, op: 'delete', uuid, updatedAt: Date.now() });
        }
    }
    /** 云端拉取合并：按 updatedAt 做 LWW */
    mergeRemote(remote) {
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
            const incoming = r.payload;
            if (!incoming)
                continue;
            if (idx < 0) {
                this.items.push(incoming);
                applied++;
            }
            else if (recordVersion(incoming) >= recordVersion(this.items[idx])) {
                this.items[idx] = incoming;
                applied++;
            }
        }
        if (applied > 0)
            this.persist();
        return applied;
    }
    /** 整表替换（导入备份用） */
    replaceAll(items, opts = {}) {
        this.load();
        this.items = items.slice();
        this.persist();
        if (!opts.silent) {
            for (const item of items) {
                pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
            }
        }
    }
    persist() {
        (0, fs_1.ensureDir)(fs_1.DB_DIR);
        (0, fs_1.writeJson)(this.file, this.items);
        this.rev += 1;
    }
}
exports.JsonCollection = JsonCollection;
// ============================== JSONL 集合（追加写） ==============================
class JsonlCollection {
    constructor(file, entity) {
        this.file = file;
        this.entity = entity;
        this.items = [];
        this.loaded = false;
        /** 写入版本号（追加/删除/整表替换都会 +1），供上层索引缓存失效判断 */
        this.rev = 0;
    }
    /** 当前写入版本（只读） */
    revision() {
        return this.rev;
    }
    load() {
        if (this.loaded)
            return;
        const raw = (0, fs_1.readText)(this.file) || '';
        const out = [];
        for (const line of raw.split('\n')) {
            const t = line.trim();
            if (!t)
                continue;
            try {
                out.push(JSON.parse(t));
            }
            catch {
                /* 跳过坏行 */
            }
        }
        this.items = out;
        this.loaded = true;
    }
    list() {
        this.load();
        return this.items.slice();
    }
    append(item) {
        this.load();
        this.items.push(item);
        (0, fs_1.ensureDir)(fs_1.DB_DIR);
        (0, fs_1.appendLine)(this.file, JSON.stringify(item));
        this.rev += 1;
        pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
    }
    removeBy(pred) {
        this.load();
        const remain = this.items.filter((it) => !pred(it));
        const removed = this.items.length - remain.length;
        if (removed > 0) {
            this.items = remain;
            this.rev += 1;
            const body = this.items.map((it) => JSON.stringify(it)).join('\n');
            (0, fs_1.writeJson)(`${this.file}.json`, this.items);
            try {
                (0, fs_1.writeTextAtomic)(this.file, body ? `${body}\n` : '');
            }
            catch {
                /* 忽略 */
            }
        }
        return removed;
    }
    replaceAll(items, opts = {}) {
        this.load();
        this.items = items.slice();
        this.rev += 1;
        const body = this.items.map((it) => JSON.stringify(it)).join('\n');
        (0, fs_1.writeJson)(`${this.file}.json`, this.items);
        try {
            (0, fs_1.writeTextAtomic)(this.file, body ? `${body}\n` : '');
        }
        catch {
            /* 忽略 */
        }
        if (!opts.silent) {
            for (const item of items) {
                pushOp({ entity: this.entity, op: 'upsert', uuid: item.uuid, updatedAt: recordVersion(item), payload: item });
            }
        }
    }
    mergeRemote(remote) {
        this.load();
        const map = new Map(this.items.map((it) => [it.uuid, it]));
        let applied = 0;
        for (const r of remote) {
            if (r.op === 'delete') {
                if (map.delete(r.uuid))
                    applied++;
                continue;
            }
            const incoming = r.payload;
            if (!incoming)
                continue;
            const cur = map.get(r.uuid);
            if (!cur || recordVersion(incoming) >= recordVersion(cur)) {
                map.set(r.uuid, incoming);
                applied++;
            }
        }
        if (applied > 0)
            this.replaceAll(Array.from(map.values()), { silent: true });
        return applied;
    }
}
exports.JsonlCollection = JsonlCollection;
/** 是否应记录同步日志（未登录也记录，登录后补传） */
function trackSync() {
    // 目前始终记录；保留钩子以便后续在"确定不用云同步"的用户上关闭
    return (0, prefs_1.isLoggedIn)() || true;
}
exports.trackSync = trackSync;
