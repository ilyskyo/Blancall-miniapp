"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptRestoreDraft = exports.scheduleDraft = exports.clearDraft = exports.loadDraft = exports.saveDraft = exports.needsDraftFallback = void 0;
const request_1 = require("../net/request");
const PREFIX = 'editor_draft:';
/** 草稿保留时长（超过视为过期） */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** iOS 才需要草稿兜底（Android 有系统拦截） */
function needsDraftFallback() {
    return (0, request_1.currentPlatform)() === 'ios';
}
exports.needsDraftFallback = needsDraftFallback;
/** 写草稿（仅在 iOS 下有效） */
function saveDraft(key, data) {
    if (!needsDraftFallback())
        return;
    try {
        wx.setStorageSync(`${PREFIX}${key}`, { data, at: Date.now() });
    }
    catch {
        /* 忽略：草稿失败不影响主流程 */
    }
}
exports.saveDraft = saveDraft;
/** 读草稿（过期或不存在返回 null） */
function loadDraft(key) {
    if (!needsDraftFallback())
        return null;
    try {
        const raw = wx.getStorageSync(`${PREFIX}${key}`);
        if (!raw || typeof raw !== 'object' || !('data' in raw))
            return null;
        if (Date.now() - (raw.at || 0) > MAX_AGE_MS) {
            clearDraft(key);
            return null;
        }
        return raw;
    }
    catch {
        return null;
    }
}
exports.loadDraft = loadDraft;
function clearDraft(key) {
    try {
        wx.removeStorageSync(`${PREFIX}${key}`);
    }
    catch {
        /* 忽略 */
    }
}
exports.clearDraft = clearDraft;
/** 防抖写草稿（编辑过程中频繁调用） */
const timers = new Map();
function scheduleDraft(key, data, delay = 1500) {
    if (!needsDraftFallback())
        return;
    const exist = timers.get(key);
    if (exist)
        clearTimeout(exist);
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        saveDraft(key, data());
    }, delay));
}
exports.scheduleDraft = scheduleDraft;
/** 提示恢复草稿；用户选择恢复时执行 onRestore */
function promptRestoreDraft(key, label, onRestore) {
    const draft = loadDraft(key);
    if (!draft)
        return;
    wx.showModal({
        title: `检测到未保存的${label}`,
        content: '上次编辑未保存，是否恢复？',
        confirmText: '恢复',
        cancelText: '放弃',
        success: (res) => {
            if (res.confirm)
                onRestore(draft.data);
            else
                clearDraft(key);
        },
    });
}
exports.promptRestoreDraft = promptRestoreDraft;
