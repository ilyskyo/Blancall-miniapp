/**
 * 轻量偏好与本地键值（wx.setStorageSync）
 * 对应 Android 端 AppPrefs + SecurePrefs 的非敏感部分（AI Key 不再本地存储，走服务端代理）
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type LightBackground = 'beige' | 'white';
export type ReviewTemplateId = 'sprint' | 'standard' | 'deep';

/** 应用设置（与 Android AppPrefs 对应的核心键） */
export interface AppSettings {
  /** 外观 */
  themeMode: ThemeMode;
  lightBackground: LightBackground;
  accentColor: number;
  subtitle: string;
  navLiquidGlass: boolean;
  /** 练习 */
  autoIndentEnabled: boolean;
  backWarningDisabled: boolean;
  reviewTemplate: string;
  useAiCloze: boolean;
  useSimilarityRating: boolean;
  showHint: boolean;
  hiddenArticles: string[];
  /** 阅读 */
  readingFontPx: number;
  readingLineHeight: number;
  readingBgMode: number;
  readingLayoutMode: number;
  readingFontId: string;
  readingFontWeight: number;
  readingOcclusionEnabled: boolean;
  readingOcclusionMode: string;
  readingOcclusionColor: number;
  /** 素材库 */
  builtInLibraryKeys: string[];
  libraryDisclaimerSeen: string[];
  /** 提醒 */
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  reminderGoalMinutes: number;
  reminderFrequency: string;
  dailyPracticeGoal: number;
  /** 引导 */
  onboardingSeen: boolean;
  sentenceHintSeen: boolean;
  /** 排行榜 */
  rankVisible: boolean;
  /** 匿名使用统计（用户可关闭；关闭后不产生任何埋点上报） */
  telemetryEnabled: boolean;
  /** AI */
  aiEnabled: boolean;
  aiHistoryEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
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

/** 本地登录态 */
export interface SessionState {
  token: string;
  expiresAt: number;
  openid: string;
  userId: string;
  nickname: string;
  avatar: string;
}

function readRaw<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(key);
    if (v === '' || v === null || v === undefined) return fallback;
    return v as T;
  } catch {
    return fallback;
  }
}

function writeRaw(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.error('[prefs] setStorage 失败', key, e);
  }
}

// ---------------- 设置 ----------------

let settingsCache: AppSettings | null = null;
const settingsListeners = new Set<(s: AppSettings) => void>();

export function getSettings(): AppSettings {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS, ...readRaw<Partial<AppSettings>>(KEY_SETTINGS, {}) };
  }
  return settingsCache;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  settingsCache = next;
  writeRaw(KEY_SETTINGS, next);
  settingsListeners.forEach((fn) => fn(next));
  return next;
}

export function onSettingsChange(fn: (s: AppSettings) => void): () => void {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}

// ---------------- 会话 ----------------

export function getSession(): SessionState | null {
  const s = readRaw<SessionState | null>(KEY_SESSION, null);
  return s && s.token ? s : null;
}

export function setSession(session: SessionState | null): void {
  writeRaw(KEY_SESSION, session);
}

export function isLoggedIn(): boolean {
  const s = getSession();
  if (!s) return false;
  return s.expiresAt > Date.now();
}

// ---------------- 权益缓存 ----------------

export interface EntitlementsCache<T = unknown> {
  data: T;
  fetchedAt: number;
}

export function getEntitlementsCache<T>(): EntitlementsCache<T> | null {
  return readRaw<EntitlementsCache<T> | null>(KEY_ENTITLEMENTS, null);
}

export function setEntitlementsCache<T>(data: T): void {
  writeRaw(KEY_ENTITLEMENTS, { data, fetchedAt: Date.now() });
}

// ---------------- 同步游标 / 设备 id / 旧 id 映射 ----------------

export function getSyncCursor(): string {
  return readRaw<string>(KEY_SYNC_CURSOR, '0');
}

export function setSyncCursor(cursor: string): void {
  writeRaw(KEY_SYNC_CURSOR, cursor);
}

export function getDeviceId(): string {
  return readRaw<string>(KEY_DEVICE_ID, '');
}

export function setDeviceId(id: string): void {
  writeRaw(KEY_DEVICE_ID, id);
}

/** 旧自增 id → uuid（一次性迁移映射，保留用于导入 Android 备份） */
export function getLocalIdMap(): Record<string, string> {
  return readRaw<Record<string, string>>(KEY_LOCAL_ID_MAP, {});
}

export function setLocalIdMap(map: Record<string, string>): void {
  writeRaw(KEY_LOCAL_ID_MAP, map);
}

/**
 * 「需要全量重排」标记：oplog 裁剪丢弃过非记录类操作时置位。
 * 下一次同步前必须先做一次本地全量快照入队，否则那些变更会永久缺同步。
 */
export function needsFullResync(): boolean {
  return readRaw<boolean>(KEY_NEEDS_FULL_RESYNC, false) === true;
}

export function setNeedsFullResync(v: boolean): void {
  writeRaw(KEY_NEEDS_FULL_RESYNC, v);
}