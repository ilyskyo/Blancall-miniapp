"use strict";
/**
 * 云同步引擎（核心学习数据）
 *
 * 协议：POST /sync/push（实体级 LWW）+ GET /sync/pull?cursor=（增量拉取）
 * 触发：登录后首次全量；应用启动；关键写操作后防抖；onHide；手动
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSyncing = exports.enqueueFullSnapshot = exports.firstSyncAfterLogin = exports.scheduleSync = exports.syncNow = void 0;
const prefs_1 = require("../storage/prefs");
const collection_1 = require("../storage/collection");
const cloud_1 = require("./cloud");
const entities_1 = require("../storage/entities");
const prefs_2 = require("../storage/prefs");
const uuid_1 = require("../utils/uuid");
const bus_1 = require("../store/bus");
function registry() {
    return {
        article: entities_1.articleStore,
        tag: entities_1.tagStore,
        tag_link: entities_1.tagLinkStore,
        practice_record: entities_1.recordStore,
        practice_state: entities_1.practiceStateStore,
        fsrs: entities_1.fsrsStore,
        custom_cloze: entities_1.customClozeStore,
        mask_config: entities_1.maskConfigStore,
        reader_prefs: entities_1.readerPrefsStore,
        home_layout: entities_1.homeLayoutStore,
        study_stat: entities_1.studyStatStore,
    };
}
const BATCH = 200;
/**
 * 推送载荷解析：oplog 只存元数据，推送前按 (entity, uuid) 从本地存储取最新实体。
 * 好处：本地 oplog 不再复制整份正文/记录（存储与写放大显著降低）。
 * 每轮只对批次里出现的实体做一次全量遍历，构建 uuid → 实体 的字典。
 */
function makePayloadResolver(batch) {
    const needed = new Map();
    for (const op of batch) {
        if (op.op !== 'upsert')
            continue; // 墓碑不需要载荷
        const set = needed.get(op.entity) || new Set();
        set.add(op.uuid);
        needed.set(op.entity, set);
    }
    const dict = new Map();
    needed.forEach((uuids, entity) => {
        if (entity === 'app_settings') {
            dict.set('app_settings:me', (0, prefs_2.getSettings)());
            return;
        }
        for (const item of itemsOfEntity(entity)) {
            const uuid = item.uuid;
            if (uuid && uuids.has(uuid))
                dict.set(`${entity}:${uuid}`, item);
        }
    });
    return (op) => (op.op === 'delete' ? undefined : dict.get(`${op.entity}:${op.uuid}`));
}
/** 本地实体清单（用于推送前解析载荷） */
function itemsOfEntity(entity) {
    switch (entity) {
        case 'article':
            return entities_1.articleStore.list();
        case 'tag':
            return entities_1.tagStore.list();
        case 'tag_link':
            return entities_1.tagLinkStore.list();
        case 'practice_record':
            return entities_1.recordStore.list();
        case 'practice_state':
            return entities_1.practiceStateStore.list();
        case 'fsrs':
            return entities_1.fsrsStore.list();
        case 'custom_cloze':
            return entities_1.customClozeStore.list();
        case 'mask_config':
            return entities_1.maskConfigStore.list();
        case 'reader_prefs':
            return entities_1.readerPrefsStore.list();
        case 'home_layout':
            return entities_1.homeLayoutStore.list();
        case 'study_stat':
            return entities_1.studyStatStore.list();
        default:
            // sentence_card 仅本地，不入队
            return [];
    }
}
let syncing = false;
let debounceTimer = null;
/** 立即同步（push → pull 循环至 hasMore=false） */
async function syncNow(options = {}) {
    if (!(0, prefs_1.isLoggedIn)())
        return { pushed: 0, pulled: 0, cursor: (0, prefs_2.getSyncCursor)(), error: '未登录' };
    if (syncing)
        return { pushed: 0, pulled: 0, cursor: (0, prefs_2.getSyncCursor)(), error: '正在同步' };
    syncing = true;
    let pushed = 0;
    let pulled = 0;
    let cursor = (0, prefs_2.getSyncCursor)();
    try {
        // ---- 裁剪留痕：先做一次本地全量快照，把此前被丢弃的非记录类变更重新入队 ----
        if ((0, prefs_2.needsFullResync)()) {
            await enqueueFullSnapshot();
            (0, prefs_2.setNeedsFullResync)(false);
            console.warn('[sync] 检测到 oplog 曾超限裁剪，已执行本地全量快照对齐');
        }
        // ---- push ----
        let ops = (0, collection_1.peekOps)();
        while (ops.length > 0) {
            const batchOps = ops.slice(0, BATCH);
            // oplog 只存元数据：推送前解析最新载荷（删除操作为墓碑，不带载荷）
            const resolvePayload = makePayloadResolver(batchOps);
            const batch = batchOps.map((o) => ({ ...o, payload: resolvePayload(o) }));
            const res = await cloudPush(batch, ensureDeviceId());
            // 响应只有 uuid/status（不含 entity）→ 从本批 op 反查 entity 与 updatedAt
            // applied 与 conflict 都算已解决：conflict 表示服务端版本胜出，随后的 pull 会对齐本地
            const byUuid = new Map(batchOps.map((o) => [o.uuid, o]));
            const resolved = res.results
                .filter((r) => r.status === 'applied' || r.status === 'conflict')
                .map((r) => byUuid.get(r.uuid))
                .filter((o) => !!o)
                .map((o) => ({ entity: o.entity, uuid: o.uuid, updatedAt: o.updatedAt }));
            const beforeAck = ops.length;
            (0, collection_1.ackOps)(resolved);
            pushed += batch.length;
            ops = (0, collection_1.peekOps)();
            // 零进展保护：一轮下来没有任何 op 出队（例如全部被服务端拒绝）→ 立即退出，避免死循环
            if (ops.length >= beforeAck) {
                console.warn('[sync] 本轮推送没有任何操作出队，已暂停推送以避免死循环');
                break;
            }
            if (batch.length < BATCH)
                break;
        }
        // ---- pull ----
        const reg = registry();
        let hasMore = true;
        let guard = 0;
        while (hasMore && guard < 40) {
            guard++;
            const res = await cloudPull(cursor, 500);
            const byEntity = new Map();
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
            (0, prefs_2.setSyncCursor)(cursor);
            hasMore = res.hasMore;
        }
        (0, bus_1.emit)(bus_1.EVT.syncFinished, { pushed, pulled, at: Date.now() });
        return { pushed, pulled, cursor };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!options.silent)
            console.error('[sync] 失败', e);
        return { pushed, pulled, cursor, error: message };
    }
    finally {
        syncing = false;
    }
}
exports.syncNow = syncNow;
/** 关键写操作后调用（防抖 6s），避免频繁请求 */
function scheduleSync(delay = 6000) {
    if (!(0, prefs_1.isLoggedIn)())
        return;
    if (debounceTimer)
        clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void syncNow({ silent: true });
    }, delay);
}
exports.scheduleSync = scheduleSync;
/** 首次登录后全量对齐：上传本地全部实体 + 拉取云端 */
async function firstSyncAfterLogin() {
    await enqueueFullSnapshot();
    return syncNow();
}
exports.firstSyncAfterLogin = firstSyncAfterLogin;
/** 把当前全部本地数据放入待同步队列（用于登录前产生的本地数据 / 裁剪后重排）
 *  只入队元数据，载荷在推送时解析，避免为全量快照复制整份正文 */
async function enqueueFullSnapshot() {
    const pushAll = (entity, items) => {
        for (const item of items) {
            enqueue({ entity, op: 'upsert', uuid: item.uuid, updatedAt: item.updatedAt || Date.now() });
        }
    };
    pushAll('article', entities_1.articleStore.list());
    pushAll('tag', entities_1.tagStore.list());
    pushAll('tag_link', entities_1.tagLinkStore.list());
    pushAll('practice_record', entities_1.recordStore.list());
    pushAll('practice_state', entities_1.practiceStateStore.list());
    pushAll('fsrs', entities_1.fsrsStore.list());
    pushAll('custom_cloze', entities_1.customClozeStore.list());
    pushAll('mask_config', entities_1.maskConfigStore.list());
    pushAll('reader_prefs', entities_1.readerPrefsStore.list());
    pushAll('home_layout', entities_1.homeLayoutStore.list());
    pushAll('study_stat', entities_1.studyStatStore.list());
    // 设置（同样只入队元数据，推送时取 getSettings()）
    enqueue({
        entity: 'app_settings',
        op: 'upsert',
        uuid: 'me',
        updatedAt: Date.now(),
    });
}
exports.enqueueFullSnapshot = enqueueFullSnapshot;
function applyRemoteSettings(items) {
    const latest = items
        .filter((it) => it.op === 'upsert' && it.payload)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .pop();
    if (!latest || !latest.payload)
        return;
    const remote = latest.payload;
    const local = (0, prefs_2.getSettings)();
    const merged = { ...local };
    for (const key of Object.keys(remote)) {
        // 本地偏外观类键以本地优先（多端各自外观），其余以云端为准
        const localOnly = ['themeMode', 'lightBackground', 'accentColor', 'subtitle', 'navLiquidGlass'];
        if (localOnly.includes(key))
            continue;
        merged[key] = remote[key];
    }
    (0, prefs_2.updateSettings)(merged);
}
// 避免循环依赖：oplog 入队封装
function enqueue(op) {
    (0, collection_1.pushOp)(op);
}
function ensureDeviceId() {
    const cur = (0, prefs_2.getDeviceId)();
    if (cur)
        return cur;
    const id = (0, uuid_1.newDeviceId)();
    (0, prefs_2.setDeviceId)(id);
    return id;
}
/** 同步状态（供 UI 展示） */
function isSyncing() {
    return syncing;
}
exports.isSyncing = isSyncing;
/** 实体级 LWW 推送（RPC sync_push_batch；RLS 限定本人数据） */
async function cloudPush(ops, deviceId) {
    const { data, error } = await (0, cloud_1.cloud)().database.rpc('sync_push_batch', {
        p_ops: ops,
        p_device_id: deviceId,
    });
    if (error)
        throw new Error((0, cloud_1.cloudErrorText)(error));
    const arr = (Array.isArray(data) ? data : []);
    const entityByUuid = new Map(ops.map((o) => [o.uuid, o.entity]));
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
async function cloudPull(cursor, limit) {
    let query = (0, cloud_1.cloud)()
        .database.from('sync_data')
        .select('entity,id,op,payload,updated_at,seq')
        .order('seq', { ascending: true })
        .limit(limit);
    const seq = Number(cursor);
    if (Number.isFinite(seq) && seq > 0)
        query = query.gt('seq', seq);
    const { data, error } = await query;
    if (error)
        throw new Error((0, cloud_1.cloudErrorText)(error));
    const rows = (data || []);
    const items = rows.map((r) => ({
        entity: r.entity,
        uuid: r.id,
        op: r.op === 'delete' ? 'delete' : 'upsert',
        updatedAt: Number(r.updated_at),
        payload: r.payload,
        rev: Number(r.seq),
    }));
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1].seq) : cursor;
    return { items, nextCursor, hasMore: rows.length >= limit };
}
