/**
 * Blancall 小程序入口
 * - 初始化设备 id、主题、登录态、云同步（登录用户）
 * - 学习时长由练习/阅读页写入 study_stat（用于排行榜）
 *
 * 【2026-10-01 加法恢复】减法期间注释的云依赖已全部恢复（initReviewTemplate /
 * initTelemetry / initAuthBridge / 启动同步 / 权益拉取 / 错误云上报）。
 * onLaunch 整体 try-catch：环境异常时降级不炸启动。
 */

import { getDeviceId, getSettings, setDeviceId, updateSettings } from './core/storage/prefs';
import { newDeviceId } from './core/utils/uuid';
import { firstSyncAfterLogin, scheduleSync, syncNow } from './core/net/sync';
import { isLoggedIn } from './core/storage/prefs';
import { initAuthBridge, loadEntitlements } from './core/net/auth';
import { cloud } from './core/net/cloud';
import { APP_VERSION } from './core/config';
import { initReviewTemplate } from './core/review/template';
import { flush, initTelemetry, track } from './core/telemetry';

App({
  globalData: {
    themeStyle: '',
    deviceId: '',
    syncAt: 0,
    appVersion: APP_VERSION,
  },

  onLaunch() {
    try {
      // 复习模板 → FSRS 目标留存率（必须先于任何复习计算，保证模板设置真实生效）
      initReviewTemplate();
      // 匿名使用统计开关（用户可在设置中关闭）
      initTelemetry();
      // 云登录态桥接：SDK 自动续期时同步本地会话，登出时清理
      initAuthBridge();

      // 埋点：会话启动（匿名，仅记版本与是否登录）
      track('session_start', { v: APP_VERSION, loggedIn: isLoggedIn() });

      // 设备 id（云同步去重与冲突排查用）
      let deviceId = getDeviceId();
      if (!deviceId) {
        deviceId = newDeviceId();
        setDeviceId(deviceId);
      }
      this.globalData.deviceId = deviceId;

      // 首次启动引导标记由 onboarding 页面处理
      const settings = getSettings();
      if (settings.reminderEnabled === undefined) {
        updateSettings({ reminderEnabled: false });
      }

      // 登录用户：启动即同步（静默）
      if (isLoggedIn()) {
        void syncNow({ silent: true }).then((res) => {
          this.globalData.syncAt = Date.now();
          if (res.error) console.warn('[app] 启动同步失败', res.error);
        });
        void loadEntitlements(true).catch((e) => console.warn('[app] 权益拉取失败', e));
      }
    } catch (e) {
      console.warn('[app] onLaunch 降级', e);
    }
  },

  onShow() {
    // 回到前台：补一次防抖同步与权益刷新
    if (isLoggedIn()) {
      scheduleSync(3000);
      void loadEntitlements().catch(() => undefined);
    }
  },

  onHide() {
    if (isLoggedIn()) void syncNow({ silent: true });
    // 埋点队列立即上报（下次进入前尽量送达）
    void flush();
  },

  onError(err: string) {
    reportError(err, 'app');
  },

  onUnhandledRejection(res: { reason?: unknown }) {
    reportError(String(res && res.reason), 'unhandled');
  },

  onPageNotFound(res: { path: string }) {
    console.warn('[app] 页面不存在', res.path);
    wx.reLaunch({ url: '/pages/home/index' });
  },
});

/** 统一错误上报（登录用户写遥测表；失败静默，不影响用户流程） */
export function reportError(message: string, page?: string): void {
  try {
    console.error('[error]', page, message);
    if (!isLoggedIn()) return;
    void cloud()
      .database.from('telemetry_events')
      .insert({
        name: 'client_error',
        props: {
          page: (page || '').slice(0, 24),
          msg: message.slice(0, 500),
          v: APP_VERSION,
        },
        client_ts: Date.now(),
      })
      .catch(() => undefined);
  } catch {
    /* 忽略 */
  }
}

/** 首登后全量对齐（登录页/账户页调用） */
export async function afterLoginSync(): Promise<void> {
  await firstSyncAfterLogin();
}
