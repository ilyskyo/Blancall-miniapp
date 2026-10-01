/**
 * 全局配置
 */

export const APP_VERSION = '1.0.0';

/** 云空间免费基准（每用户；上传用量真实聚合自 uploads 表） */
export const FREE_SPACE_BASE_BYTES = 500 * 1024 * 1024;

/** 排行榜刷新间隔（毫秒） */
export const LEADERBOARD_CACHE_MS = 5 * 60 * 1000;

/** 权益缓存有效期（毫秒） */
export const ENTITLEMENT_CACHE_MS = 10 * 60 * 1000;

/** 上传限制 */
export const LIMITS = {
  documentMaxBytes: 50 * 1024 * 1024,
  fontMaxBytes: 20 * 1024 * 1024,
  avatarMaxBytes: 2 * 1024 * 1024,
  /** 单次 AI 挖空请求最大字符数；超出部分由本地算法补齐挖空 */
  aiClozeMaxChars: 12000,
};

/** 素材库（gaokao 仅文本，内置离线包） */
export const LIBRARIES = [
  {
    key: 'gaokao',
    name: '高考必背 60 篇',
    desc: '高考语文必背 60 篇（文本版）',
  },
] as const;

/**
 * 订阅消息模板 id（需在微信公众平台「订阅消息」申请后替换）
 * 说明：小程序无常驻后台，学习提醒由云函数/服务端定时任务读取用户
 * app_settings 中的 reminder* 字段后发送订阅消息。当前未配置 = 提醒功能未上线。
 */
export const SUBSCRIBE_TEMPLATE_IDS = {
  studyReminder: 'REPLACE_WITH_YOUR_TEMPLATE_ID',
};
