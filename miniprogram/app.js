"use strict";
/**
 * Blancall 小程序入口
 * - 初始化设备 id、主题、登录态、云同步（登录用户）
 * - 学习时长由练习/阅读页写入 study_stat（用于排行榜）
 *
 * 【2026-10-01 加法恢复】减法期间注释的云依赖已全部恢复（initReviewTemplate /
 * initTelemetry / initAuthBridge / 启动同步 / 权益拉取 / 错误云上报）。
 * onLaunch 整体 try-catch：环境异常时降级不炸启动。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.afterLoginSync = exports.reportError = void 0;
const prefs_1 = require("./core/storage/prefs");
const uuid_1 = require("./core/utils/uuid");
const sync_1 = require("./core/net/sync");
const prefs_2 = require("./core/storage/prefs");
const auth_1 = require("./core/net/auth");
const cloud_1 = require("./core/net/cloud");
const config_1 = require("./core/config");
const template_1 = require("./core/review/template");
const telemetry_1 = require("./core/telemetry");
App({
    globalData: {
        themeStyle: '',
        deviceId: '',
        syncAt: 0,
        appVersion: config_1.APP_VERSION,
    },
    onLaunch() {
        try {
            // 复习模板 → FSRS 目标留存率（必须先于任何复习计算，保证模板设置真实生效）
            (0, template_1.initReviewTemplate)();
            // 匿名使用统计开关（用户可在设置中关闭）
            (0, telemetry_1.initTelemetry)();
            // 云登录态桥接：SDK 自动续期时同步本地会话，登出时清理
            (0, auth_1.initAuthBridge)();
            // 埋点：会话启动（匿名，仅记版本与是否登录）
            (0, telemetry_1.track)('session_start', { v: config_1.APP_VERSION, loggedIn: (0, prefs_2.isLoggedIn)() });
            // 设备 id（云同步去重与冲突排查用）
            let deviceId = (0, prefs_1.getDeviceId)();
            if (!deviceId) {
                deviceId = (0, uuid_1.newDeviceId)();
                (0, prefs_1.setDeviceId)(deviceId);
            }
            this.globalData.deviceId = deviceId;
            // 首次启动引导标记由 onboarding 页面处理
            const settings = (0, prefs_1.getSettings)();
            if (settings.reminderEnabled === undefined) {
                (0, prefs_1.updateSettings)({ reminderEnabled: false });
            }
            // 登录用户：启动即同步（静默）
            if ((0, prefs_2.isLoggedIn)()) {
                void (0, sync_1.syncNow)({ silent: true }).then((res) => {
                    this.globalData.syncAt = Date.now();
                    if (res.error)
                        console.warn('[app] 启动同步失败', res.error);
                });
                void (0, auth_1.loadEntitlements)(true).catch((e) => console.warn('[app] 权益拉取失败', e));
            }
        }
        catch (e) {
            console.warn('[app] onLaunch 降级', e);
        }
    },
    onShow() {
        // 回到前台：补一次防抖同步与权益刷新
        if ((0, prefs_2.isLoggedIn)()) {
            (0, sync_1.scheduleSync)(3000);
            void (0, auth_1.loadEntitlements)().catch(() => undefined);
        }
    },
    onHide() {
        if ((0, prefs_2.isLoggedIn)())
            void (0, sync_1.syncNow)({ silent: true });
        // 埋点队列立即上报（下次进入前尽量送达）
        void (0, telemetry_1.flush)();
    },
    onError(err) {
        reportError(err, 'app');
    },
    onUnhandledRejection(res) {
        reportError(String(res && res.reason), 'unhandled');
    },
    onPageNotFound(res) {
        console.warn('[app] 页面不存在', res.path);
        wx.reLaunch({ url: '/pages/home/index' });
    },
});
/** 统一错误上报（登录用户写遥测表；失败静默，不影响用户流程） */
function reportError(message, page) {
    try {
        console.error('[error]', page, message);
        if (!(0, prefs_2.isLoggedIn)())
            return;
        void (0, cloud_1.cloud)()
            .database.from('telemetry_events')
            .insert({
            name: 'client_error',
            props: {
                page: (page || '').slice(0, 24),
                msg: message.slice(0, 500),
                v: config_1.APP_VERSION,
            },
            client_ts: Date.now(),
        })
            .catch(() => undefined);
    }
    catch {
        /* 忽略 */
    }
}
exports.reportError = reportError;
/** 首登后全量对齐（登录页/账户页调用） */
async function afterLoginSync() {
    await (0, sync_1.firstSyncAfterLogin)();
}
exports.afterLoginSync = afterLoginSync;
