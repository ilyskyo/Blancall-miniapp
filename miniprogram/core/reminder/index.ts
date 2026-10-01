/**
 * 学习提醒（订阅消息）
 *
 * 小程序没有系统通知与常驻后台，因此：
 * 1) 前端负责"请求订阅授权"（一次性订阅，用户可勾选"总是保持以上选择"）
 * 2) 服务端定时任务读取用户 app_settings（同步实体）中的提醒配置后发送
 *
 * 该模块只负责第 1 步与本地配置写入。
 */

import { SUBSCRIBE_TEMPLATE_IDS } from '../config';
import { getSettings, updateSettings } from '../storage/prefs';
import { isLoggedIn } from '../storage/prefs';
import { scheduleSync } from '../net/sync';

export type ReminderFrequency = 'DAILY' | 'WEEKLY_FIVE' | 'WEEKLY_THREE' | 'OFF';

export interface ReminderConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  goalMinutes: number;
  frequency: ReminderFrequency;
}

export function getReminderConfig(): ReminderConfig {
  const s = getSettings();
  return {
    enabled: !!s.reminderEnabled,
    hour: s.reminderHour,
    minute: s.reminderMinute,
    goalMinutes: s.reminderGoalMinutes,
    frequency: (s.reminderFrequency as ReminderFrequency) || 'DAILY',
  };
}

/** 保存提醒配置（随 app_settings 云同步，服务端据此调度） */
export function saveReminderConfig(patch: Partial<ReminderConfig>): ReminderConfig {
  const next = { ...getReminderConfig(), ...patch };
  updateSettings({
    reminderEnabled: next.enabled,
    reminderHour: next.hour,
    reminderMinute: next.minute,
    reminderGoalMinutes: next.goalMinutes,
    reminderFrequency: next.frequency,
  });
  scheduleSync(1000);
  return next;
}

/**
 * 请求订阅授权（开启提醒时调用）
 * 注意：一次性订阅每授权一次仅可发送一条；建议在用户每次进入小程序时按需补充授权。
 */
export function requestSubscribe(): Promise<{ accepted: number; rejected: number }> {
  return new Promise((resolve) => {
    if (!isLoggedIn()) {
      resolve({ accepted: 0, rejected: 0 });
      return;
    }
    const tmplIds = Object.values(SUBSCRIBE_TEMPLATE_IDS).filter((id) => id && !id.startsWith('REPLACE_'));
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
          const v = (res as Record<string, string>)[id];
          if (v === 'accept') accepted += 1;
          else rejected += 1;
        });
        resolve({ accepted, rejected });
      },
      fail: () => resolve({ accepted: 0, rejected: 0 }),
    });
  });
}

/** 频率文案 */
export function frequencyLabel(freq: ReminderFrequency): string {
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

/** 提醒文案预览（与 Android 端优先级一致：未完成练习 > 薄弱内容 > 连续学习 > 今日未学） */
export function reminderPreviewText(params: {
  inProgressCount: number;
  weakCount: number;
  streak: number;
  studiedToday: boolean;
}): string {
  if (params.inProgressCount > 0) return `📝继续未完成的练习（还剩 ${params.inProgressCount} 篇）`;
  if (params.weakCount > 0) return `🎯薄弱内容巩固（还有 ${params.weakCount} 个易错内容）`;
  if (params.streak > 0 && !params.studiedToday) return `🔥连续学习第 ${params.streak} 天，今天还没练哦`;
  if (!params.studiedToday) return '📖今日背诵提醒';
  return '今日已完成，欢迎继续巩固';
}