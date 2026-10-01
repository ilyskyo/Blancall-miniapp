/**
 * 设置页辅助逻辑（提醒订阅 / 内容导出 / 清空本地数据）
 */

import {
  articleStore,
  customClozeStore,
  fsrsStore,
  homeLayoutStore,
  maskConfigStore,
  practiceStateStore,
  readerPrefsStore,
  recordStore,
  sentenceCardStore,
  studyStatStore,
  tagLinkStore,
  tagStore,
} from '../../core/storage/entities';
import { emit, EVT } from '../../core/store/bus';

/**
 * 学习提醒订阅消息模板 id。
 * ⚠️ 需在微信公众平台「订阅消息」中申请「学习提醒」模板后，把此处替换为真实模板 id；
 * 未替换时订阅请求会失败（仅降级提示，不影响其他设置）。
 */
export const REMINDER_TMPL_ID = 'REPLACE_WITH_MP_SUBSCRIBE_TEMPLATE_ID';

/**
 * 请求一次性订阅授权（微信侧提醒依赖服务端在设定时间发送订阅消息）。
 * @returns 是否获得授权
 */
export function requestReminderSubscribe(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [REMINDER_TMPL_ID],
      success: (res) => resolve(res[REMINDER_TMPL_ID] === 'accept'),
      fail: () => resolve(false),
    });
  });
}

/** 导出练习记录 CSV / 数据备份（依赖服务端生成，当前未上线） */
export async function exportToChat(_kind: 'csv' | 'backup'): Promise<void> {
  throw new Error('导出功能即将上线，敬请期待');
}

/** 清空本地数据（文章/记录/标签/配置/进度/偏好/统计，云端不受影响） */
export function clearLocalData(): void {
  articleStore.replaceAll([], { silent: true });
  recordStore.replaceAll([], { silent: true });
  tagStore.replaceAll([], { silent: true });
  tagLinkStore.replaceAll([], { silent: true });
  practiceStateStore.replaceAll([], { silent: true });
  fsrsStore.replaceAll([], { silent: true });
  customClozeStore.replaceAll([], { silent: true });
  maskConfigStore.replaceAll([], { silent: true });
  readerPrefsStore.replaceAll([], { silent: true });
  homeLayoutStore.replaceAll([], { silent: true });
  studyStatStore.replaceAll([], { silent: true });
  sentenceCardStore.replaceAll([], { silent: true });
  emit(EVT.articlesChanged);
  emit(EVT.recordsChanged);
  emit(EVT.tagsChanged);
  emit(EVT.homeLayoutChanged);
}

/** 字节 → 展示文案 */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)}GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

/** 错误 → 可读文案（catch 变量为 unknown） */
export function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return '操作失败，请稍后重试';
}