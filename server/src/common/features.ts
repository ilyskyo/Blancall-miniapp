/**
 * 共享业务常量（免费版）：空间上限 / AI 用量口径 / 签到里程碑
 * 【2026-10-01 免费化】原 entitlements/features.ts 的会员、SKU、限时活动等付费概念已删。
 */

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/** 每用户上传空间上限（完全免费，统一额度） */
export const FREE_SPACE_BYTES = 300 * MB;

/** AI 用量口径（仅用于日预算熔断统计，不涉及任何收费） */
export const AI_COST_RULE = {
  /** 挖空：每 500 字符（向上取整）计 1 个用量单位 */
  perChars: 500,
  /** 训练分析：1 单位/次 */
  analysis: 1,
  /** 对话：1 单位/条 */
  chat: 1,
} as const;

/** 挖空 AI 用量：ceil(字符数 / 500)，至少 1 */
export function clozeCost(chars: number): number {
  return Math.max(1, Math.ceil(chars / AI_COST_RULE.perChars));
}

/** 签到里程碑：相对连续天数（每轮 30 天内的第几天） */
export const CHECKIN_MILESTONES: Record<number, number> = {
  3: 1,
  7: 3,
  10: 5,
  15: 7,
  30: 10,
};

export const CHECKIN_CYCLE_LEN = 30;

export function milestoneDayOfStreak(streak: number): number {
  const day = ((streak - 1) % CHECKIN_CYCLE_LEN) + 1;
  return day;
}

export function milestoneRewardDays(streak: number): number | null {
  const day = milestoneDayOfStreak(streak);
  return CHECKIN_MILESTONES[day] ?? null;
}
