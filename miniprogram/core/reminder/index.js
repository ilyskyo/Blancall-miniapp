"use strict";
/**
 * 学习提醒（订阅消息）
 *
 * 小程序没有系统通知与常驻后台，因此：
 * 1) 前端负责"请求订阅授权"（一次性订阅，用户可勾选"总是保持以上选择"）
 * 2) 服务端定时任务读取用户 app_settings（同步实体）中的提醒配置后发送
 *
 * 该模块只负责第 1 步与本地配置写入。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reminderPreviewText = exports.frequencyLabel = exports.requestSubscribe = exports.saveReminderConfig = exports.getReminderConfig = void 0;
const config_1 = require("../config");
const prefs_1 = require("../storage/prefs");
const prefs_2 = require("../storage/prefs");
const sync_1 = require("../net/sync");
function getReminderConfig() {
    const s = (0, prefs_1.getSettings)();
    return {
        enabled: !!s.reminderEnabled,
        hour: s.reminderHour,
        minute: s.reminderMinute,
        goalMinutes: s.reminderGoalMinutes,
        frequency: s.reminderFrequency || 'DAILY',
    };
}
exports.getReminderConfig = getReminderConfig;
/** 保存提醒配置（随 app_settings 云同步，服务端据此调度） */
function saveReminderConfig(patch) {
    const next = { ...getReminderConfig(), ...patch };
    (0, prefs_1.updateSettings)({
        reminderEnabled: next.enabled,
        reminderHour: next.hour,
        reminderMinute: next.minute,
        reminderGoalMinutes: next.goalMinutes,
        reminderFrequency: next.frequency,
    });
    (0, sync_1.scheduleSync)(1000);
    return next;
}
exports.saveReminderConfig = saveReminderConfig;
/**
 * 请求订阅授权（开启提醒时调用）
 * 注意：一次性订阅每授权一次仅可发送一条；建议在用户每次进入小程序时按需补充授权。
 */
function requestSubscribe() {
    return new Promise((resolve) => {
        if (!(0, prefs_2.isLoggedIn)()) {
            resolve({ accepted: 0, rejected: 0 });
            return;
        }
        const tmplIds = Object.values(config_1.SUBSCRIBE_TEMPLATE_IDS).filter((id) => id && !id.startsWith('REPLACE_'));
        if (tmplIds.length === 0) {
            wx.showModal({
                title: '提醒模板未配置',
                content: '订阅消息模板 id 尚未在服务端配置（见 core/config.ts），当前仅站内提醒可用。',
                showCancel: false,
            });
            resolve({ accepted: 0, rejected: 0 });
            return;
        }
        wx.requestSubscribeMessage({
            tmplIds,
            success: (res) => {
                let accepted = 0;
                let rejected = 0;
                tmplIds.forEach((id) => {
                    const v = res[id];
                    if (v === 'accept')
                        accepted += 1;
                    else
                        rejected += 1;
                });
                resolve({ accepted, rejected });
            },
            fail: () => resolve({ accepted: 0, rejected: 0 }),
        });
    });
}
exports.requestSubscribe = requestSubscribe;
/** 频率文案 */
function frequencyLabel(freq) {
    switch (freq) {
        case 'DAILY':
            return '每天';
        case 'WEEKLY_FIVE':
            return '周一至周五';
        case 'WEEKLY_THREE':
            return '周一、三、五';
        default:
            return '关闭';
    }
}
exports.frequencyLabel = frequencyLabel;
/** 提醒文案预览（与 Android 端优先级一致：未完成练习 > 薄弱内容 > 连续学习 > 今日未学） */
function reminderPreviewText(params) {
    if (params.inProgressCount > 0)
        return `📝继续未完成的练习（还剩 ${params.inProgressCount} 篇）`;
    if (params.weakCount > 0)
        return `🎯薄弱内容巩固（还有 ${params.weakCount} 个易错内容）`;
    if (params.streak > 0 && !params.studiedToday)
        return `🔥连续学习第 ${params.streak} 天，今天还没练哦`;
    if (!params.studiedToday)
        return '📖今日背诵提醒';
    return '今日已完成，欢迎继续巩固';
}
exports.reminderPreviewText = reminderPreviewText;
