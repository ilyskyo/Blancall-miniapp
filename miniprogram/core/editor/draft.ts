/**
 * 编辑页草稿暂存（跨平台一致的"未保存离开"保护）
 *
 * 背景：`wx.enableAlertBeforeUnload` **仅 Android 支持**，iOS 上会静默失效，
 * 用户在 iOS 编辑自定义挖空/遮罩时退出会直接丢失编辑内容。
 *
 * 方案：
 * - Android：继续使用系统级二次确认（体验更好，无额外存储）
 * - iOS：编辑过程中防抖写入草稿到 Storage；下次进入时提示"恢复/放弃"
 * - 任何平台保存成功后都清除草稿
 */

import { currentPlatform } from '../net/request';

const PREFIX = 'editor_draft:';
/** 草稿保留时长（超过视为过期） */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface DraftEnvelope<T> {
  data: T;
  at: number;
}

/** iOS 才需要草稿兜底（Android 有系统拦截） */
export function needsDraftFallback(): boolean {
  return currentPlatform() === 'ios';
}

/** 写草稿（仅在 iOS 下有效） */
export function saveDraft<T>(key: string, data: T): void {
  if (!needsDraftFallback()) return;
  try {
    wx.setStorageSync(`${PREFIX}${key}`, { data, at: Date.now() } satisfies DraftEnvelope<T>);
  } catch {
    /* 忽略：草稿失败不影响主流程 */
  }
}

/** 读草稿（过期或不存在返回 null） */
export function loadDraft<T>(key: string): DraftEnvelope<T> | null {
  if (!needsDraftFallback()) return null;
  try {
    const raw = wx.getStorageSync(`${PREFIX}${key}`) as DraftEnvelope<T> | '' | null;
    if (!raw || typeof raw !== 'object' || !('data' in raw)) return null;
    if (Date.now() - (raw.at || 0) > MAX_AGE_MS) {
      clearDraft(key);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    wx.removeStorageSync(`${PREFIX}${key}`);
  } catch {
    /* 忽略 */
  }
}

/** 防抖写草稿（编辑过程中频繁调用） */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleDraft<T>(key: string, data: () => T, delay = 1500): void {
  if (!needsDraftFallback()) return;
  const exist = timers.get(key);
  if (exist) clearTimeout(exist);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      saveDraft(key, data());
    }, delay)
  );
}

/** 提示恢复草稿；用户选择恢复时执行 onRestore */
export function promptRestoreDraft<T>(key: string, label: string, onRestore: (data: T) => void): void {
  const draft = loadDraft<T>(key);
  if (!draft) return;
  wx.showModal({
    title: `检测到未保存的${label}`,
    content: '上次编辑未保存，是否恢复？',
    confirmText: '恢复',
    cancelText: '放弃',
    success: (res) => {
      if (res.confirm) onRestore(draft.data);
      else clearDraft(key);
    },
  });
}