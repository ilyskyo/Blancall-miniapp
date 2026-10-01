"use strict";
/**
 * 轻量偏好与本地键值（wx.setStorageSync）
 * 对应 Android 端 AppPrefs + SecurePrefs 的非敏感部分（AI Key 不再本地存储，走服务端代理）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setNeedsFullResync = exports.needsFullResync = exports.setLocalIdMap = exports.getLocalIdMap = exports.setDeviceId = exports.getDeviceId = exports.setSyncCursor = exports.getSyncCursor = exports.setEntitlementsCache = exports.getEntitlementsCache = exports.isLoggedIn = exports.setSession = exports.getSession = exports.onSettingsChange = exports.updateSettings = exports.getSettings = exports.DEFAULT_SETTINGS = void 0;
exports.DEFAULT_SETTINGS = {
    themeMode: 'system',
    lightBackground: 'beige',
    accentColor: 0,
    subtitle: '',
    navLiquidGlass: true,
    autoIndentEnabled: true,
    backWarningDisabled: false,
    reviewTemplate: 'standard',
    useAiCloze: false,
    useSimilarityRating: true,
    showHint: true,
    hiddenArticles: [],
    readingFontPx: 17,
    readingLineHeight: 2.0,
    readingBgMode: 0,
    readingLayoutMode: 0,
    readingFontId: '0',
    readingFontWeight: 400,
    readingOcclusionEnabled: false,
    readingOcclusionMode: 'long',
    readingOcclusionColor: 0,
    builtInLibraryKeys: [],
    libraryDisclaimerSeen: [],
    reminderEnabled: false,
    reminderHour: 20,
    reminderMinute: 0,
    reminderGoalMinutes: 10,
    reminderFrequency: 'DAILY',
    dailyPracticeGoal: 3,
    onboardingSeen: false,
    sentenceHintSeen: false,
    rankVisible: true,
    telemetryEnabled: true,
    aiEnabled: false,
    aiHistoryEnabled: true,
};
const KEY_SETTINGS = 'app_prefs';
const KEY_SESSION = 'session';
const KEY_ENTITLEMENTS = 'entitlements_cache';
const KEY_SYNC_CURSOR = 'sync_cursor';
const KEY_DEVICE_ID = 'device_id';
const KEY_LOCAL_ID_MAP = 'local_id_map';
const KEY_NEEDS_FULL_RESYNC = 'sync_needs_full_resync';
function readRaw(key, fallback) {
    try {
        const v = wx.getStorageSync(key);
        if (v === '' || v === null || v === undefined)
            return fallback;
        return v;
    }
    catch {
        return fallback;
    }
}
function writeRaw(key, value) {
    try {
        wx.setStorageSync(key, value);
    }
    catch (e) {
        console.error('[prefs] setStorage 失败', key, e);
    }
}
// ---------------- 设置 ----------------
let settingsCache = null;
const settingsListeners = new Set();
function getSettings() {
    if (!settingsCache) {
        settingsCache = { ...exports.DEFAULT_SETTINGS, ...readRaw(KEY_SETTINGS, {}) };
    }
    return settingsCache;
}
exports.getSettings = getSettings;
function updateSettings(patch) {
    const next = { ...getSettings(), ...patch };
    settingsCache = next;
    writeRaw(KEY_SETTINGS, next);
    settingsListeners.forEach((fn) => fn(next));
    return next;
}
exports.updateSettings = updateSettings;
function onSettingsChange(fn) {
    settingsListeners.add(fn);
    return () => settingsListeners.delete(fn);
}
exports.onSettingsChange = onSettingsChange;
// ---------------- 会话 ----------------
function getSession() {
    const s = readRaw(KEY_SESSION, null);
    return s && s.token ? s : null;
}
exports.getSession = getSession;
function setSession(session) {
    writeRaw(KEY_SESSION, session);
}
exports.setSession = setSession;
function isLoggedIn() {
    const s = getSession();
    if (!s)
        return false;
    return s.expiresAt > Date.now();
}
exports.isLoggedIn = isLoggedIn;
function getEntitlementsCache() {
    return readRaw(KEY_ENTITLEMENTS, null);
}
exports.getEntitlementsCache = getEntitlementsCache;
function setEntitlementsCache(data) {
    writeRaw(KEY_ENTITLEMENTS, { data, fetchedAt: Date.now() });
}
exports.setEntitlementsCache = setEntitlementsCache;
// ---------------- 同步游标 / 设备 id / 旧 id 映射 ----------------
function getSyncCursor() {
    return readRaw(KEY_SYNC_CURSOR, '0');
}
exports.getSyncCursor = getSyncCursor;
function setSyncCursor(cursor) {
    writeRaw(KEY_SYNC_CURSOR, cursor);
}
exports.setSyncCursor = setSyncCursor;
function getDeviceId() {
    return readRaw(KEY_DEVICE_ID, '');
}
exports.getDeviceId = getDeviceId;
function setDeviceId(id) {
    writeRaw(KEY_DEVICE_ID, id);
}
exports.setDeviceId = setDeviceId;
/** 旧自增 id → uuid（一次性迁移映射，保留用于导入 Android 备份） */
function getLocalIdMap() {
    return readRaw(KEY_LOCAL_ID_MAP, {});
}
exports.getLocalIdMap = getLocalIdMap;
function setLocalIdMap(map) {
    writeRaw(KEY_LOCAL_ID_MAP, map);
}
exports.setLocalIdMap = setLocalIdMap;
/**
 * 「需要全量重排」标记：oplog 裁剪丢弃过非记录类操作时置位。
 * 下一次同步前必须先做一次本地全量快照入队，否则那些变更会永久缺同步。
 */
function needsFullResync() {
    return readRaw(KEY_NEEDS_FULL_RESYNC, false) === true;
}
exports.needsFullResync = needsFullResync;
function setNeedsFullResync(v) {
    writeRaw(KEY_NEEDS_FULL_RESYNC, v);
}
exports.setNeedsFullResync = setNeedsFullResync;
