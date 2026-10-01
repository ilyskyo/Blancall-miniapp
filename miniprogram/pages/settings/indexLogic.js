"use strict";
/**
 * 设置页辅助逻辑（提醒订阅 / 内容导出 / 清空本地数据）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errText = exports.fmtBytes = exports.clearLocalData = exports.exportToChat = exports.requestReminderSubscribe = exports.REMINDER_TMPL_ID = void 0;
const entities_1 = require("../../core/storage/entities");
const bus_1 = require("../../core/store/bus");
/**
 * 学习提醒订阅消息模板 id。
 * ⚠️ 需在微信公众平台「订阅消息」中申请「学习提醒」模板后，把此处替换为真实模板 id；
 * 未替换时订阅请求会失败（仅降级提示，不影响其他设置）。
 */
exports.REMINDER_TMPL_ID = 'REPLACE_WITH_MP_SUBSCRIBE_TEMPLATE_ID';
/**
 * 请求一次性订阅授权（微信侧提醒依赖服务端在设定时间发送订阅消息）。
 * @returns 是否获得授权
 */
function requestReminderSubscribe() {
    return new Promise((resolve) => {
        wx.requestSubscribeMessage({
            tmplIds: [exports.REMINDER_TMPL_ID],
            success: (res) => resolve(res[exports.REMINDER_TMPL_ID] === 'accept'),
            fail: () => resolve(false),
        });
    });
}
exports.requestReminderSubscribe = requestReminderSubscribe;
/** 导出练习记录 CSV / 数据备份（依赖服务端生成，当前未上线） */
async function exportToChat(_kind) {
    throw new Error('导出功能即将上线，敬请期待');
}
exports.exportToChat = exportToChat;
/** 清空本地数据（文章/记录/标签/配置/进度/偏好/统计，云端不受影响） */
function clearLocalData() {
    entities_1.articleStore.replaceAll([], { silent: true });
    entities_1.recordStore.replaceAll([], { silent: true });
    entities_1.tagStore.replaceAll([], { silent: true });
    entities_1.tagLinkStore.replaceAll([], { silent: true });
    entities_1.practiceStateStore.replaceAll([], { silent: true });
    entities_1.fsrsStore.replaceAll([], { silent: true });
    entities_1.customClozeStore.replaceAll([], { silent: true });
    entities_1.maskConfigStore.replaceAll([], { silent: true });
    entities_1.readerPrefsStore.replaceAll([], { silent: true });
    entities_1.homeLayoutStore.replaceAll([], { silent: true });
    entities_1.studyStatStore.replaceAll([], { silent: true });
    entities_1.sentenceCardStore.replaceAll([], { silent: true });
    (0, bus_1.emit)(bus_1.EVT.articlesChanged);
    (0, bus_1.emit)(bus_1.EVT.recordsChanged);
    (0, bus_1.emit)(bus_1.EVT.tagsChanged);
    (0, bus_1.emit)(bus_1.EVT.homeLayoutChanged);
}
exports.clearLocalData = clearLocalData;
/** 字节 → 展示文案 */
function fmtBytes(bytes) {
    if (bytes >= 1073741824)
        return `${(bytes / 1073741824).toFixed(2)}GB`;
    if (bytes >= 1048576)
        return `${(bytes / 1048576).toFixed(1)}MB`;
    return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}
exports.fmtBytes = fmtBytes;
/** 错误 → 可读文案（catch 变量为 unknown） */
function errText(e) {
    if (e instanceof Error && e.message)
        return e.message;
    return '操作失败，请稍后重试';
}
exports.errText = errText;
