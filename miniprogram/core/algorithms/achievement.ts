/**
 * 成就徽章管理器（移植自 Android 端 `algorithm/AchievementManager.kt`，逐行对齐）
 *
 * 设计说明：解锁状态由当前数据派生计算，不持久化"已解锁"标记，
 * 保证数据与状态强一致（记录只增不减类徽章一旦达成即永久解锁）。
 */

import { PracticeRecordEntity } from './types';

/** 单个成就定义与当前解锁状态 */
export interface Achievement {
  id: string;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  /** 解锁进度 0..1；已解锁恒为 1 */
  progress: number;
  /** 进度描述（如 "3/7 天"） */
  progressText: string;
}

/** Kotlin `coerceIn(0f, 1f)` */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ach(
  id: string, icon: string, title: string, description: string,
  unlocked: boolean, progress: number, progressText: string,
): Achievement {
  return { id, icon, title, description, unlocked, progress, progressText };
}

export const AchievementManager = {
  /**
   * 评估全部成就的解锁状态。
   *
   * @param records        全部练习记录
   * @param longestStreak   历史最长连续天数
   * @param currentStreak  当前连续天数（当前规则未使用，保留签名一致）
   */
  evaluate(
    records: PracticeRecordEntity[],
    longestStreak: number,
    currentStreak: number,
  ): Achievement[] {
    const totalPractices = records.length;
    const perfectCount = records.filter((it) => it.totalBlanks > 0 && it.correctCount === it.totalBlanks).length;
    const modesUsed = new Set(records.map((it) => it.mode)).size;
    // Kotlin Long 整数除法，向零截断
    const totalDurationMin = Math.trunc(records.reduce((sum, it) => sum + it.duration, 0) / 60000);
    // 单篇最高练习次数
    const perArticle = new Map<string, number>();
    for (const r of records) perArticle.set(r.articleUuid, (perArticle.get(r.articleUuid) ?? 0) + 1);
    let maxArticlePractices = 0;
    for (const n of perArticle.values()) if (n > maxArticlePractices) maxArticlePractices = n;

    return [
      ach('first_practice', '🌱', '初心', '完成首次练习',
        totalPractices >= 1,
        clamp01(totalPractices / 1),
        `${totalPractices}/1 次`),
      ach('practice_10', '📚', '勤学', '累计 10 次练习',
        totalPractices >= 10,
        clamp01(totalPractices / 10),
        `${totalPractices}/10 次`),
      ach('practice_100', '💪', '百炼', '累计 100 次练习',
        totalPractices >= 100,
        clamp01(totalPractices / 100),
        `${totalPractices}/100 次`),
      ach('streak_7', '🔥', '连击一周', '连续学习 7 天',
        longestStreak >= 7,
        clamp01(longestStreak / 7),
        `${longestStreak}/7 天`),
      ach('streak_30', '🔥', '连击一月', '连续学习 30 天',
        longestStreak >= 30,
        clamp01(longestStreak / 30),
        `${longestStreak}/30 天`),
      ach('streak_100', '👑', '百日坚持', '连续学习 100 天',
        longestStreak >= 100,
        clamp01(longestStreak / 100),
        `${longestStreak}/100 天`),
      ach('perfect_one', '✨', '满分时刻', '获得一次满分',
        perfectCount >= 1,
        clamp01(perfectCount / 1),
        `${perfectCount}/1 次`),
      ach('perfect_ten', '💎', '完美主义', '累计 10 次满分',
        perfectCount >= 10,
        clamp01(perfectCount / 10),
        `${perfectCount}/10 次`),
      ach('all_modes', '🎯', '全才', '体验全部三种练习模式',
        modesUsed >= 3,
        clamp01(modesUsed / 3),
        `${modesUsed}/3 种`),
      ach('focus_60', '⏱️', '专注', '累计练习 60 分钟',
        totalDurationMin >= 60,
        clamp01(totalDurationMin / 60),
        `${totalDurationMin}/60 分`),
      ach('deep_10', '🧠', '深度钻研', '单篇练习 10 次',
        maxArticlePractices >= 10,
        clamp01(maxArticlePractices / 10),
        `${maxArticlePractices}/10 次`),
    ];
  },
};