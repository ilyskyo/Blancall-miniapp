/**
 * 遗忘曲线预测器（移植自 Android 端 `algorithm/ForgettingPredictor.kt`，逐行对齐）
 *
 * 在艾宾浩斯调度基础上，叠加指数衰减记忆留存率模型。
 *
 * ## 数学模型
 *
 * **留存率（Retention Rate）** —— 艾宾浩斯-斯皮尔丁指数衰减公式：
 * ```
 * R(Δt) = e^(-Δt / S)
 * ```
 * - Δt = 当前时间 - 最近一次练习时间（天）
 * - S  = 记忆强度（天），由练习历史估算
 *
 * **记忆强度（Memory Strength）估算** —— 借鉴 SM-2 算法的稳定性增长思想：
 * ```
 * S_1 = 1 天                  （首次学习后的初始稳定性）
 * S_{n+1} = S_n × (1 + g × a_n)  （每次成功复习后稳定性增长）
 * ```
 * - g = 0.5（增益系数）
 * - a_n = 第 n 次练习的正确率（0-1）；a_n < 0.3 时视为未掌握，S 不增长
 *
 * ## 复习调度
 * 下次复习时间仍调用 EbbinghausScheduler.nextReviewTime，保证与首页提醒全局一致。
 */

import { ArticleEntity, PracticeRecordEntity } from './types';
import { CardState, FsrsEngine } from './fsrs';
import { EbbinghausScheduler, ReviewTemplate } from './ebbinghaus';

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/** 记忆强度增益系数 g（每次成功复习使稳定性增长的倍率） */
const STRENGTH_GAIN = 0.5;
/** 初始记忆强度 S_1（天） */
const INITIAL_STRENGTH_DAYS = 1;
/** 未掌握阈值：正确率低于此值时稳定性不增长 */
const UNMASTERED_THRESHOLD = 0.3;
/** 衰减曲线采样天数（覆盖一个标准复习周期） */
const DECAY_CURVE_DAYS = 30;
/** Kotlin Int.MAX_VALUE（未开始/已掌握时 daysLeft 的取值） */
const INT_MAX = 2147483647;

/** Kotlin `Double.toInt()`：向零截断（-0 归一为 0） */
function kotlinToInt(x: number): number {
  if (Number.isNaN(x)) return 0;
  const t = Math.trunc(x);
  return t === 0 ? 0 : t;
}

/** 本地日历日键（用于按天去重统计复习轮次） */
function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * 预测紧急度。ordinal 由高到低排序，数值越小越需要尽快复习。
 */
export enum Urgency {
  /** 已逾期（应复习时间已过且超过 1 天） */
  OVERDUE = 0,
  /** 今天到期（含恰好到期与已过期不足 1 天） */
  TODAY = 1,
  /** 3 天内到期 */
  SOON = 2,
  /** 更远（3 天以上） */
  LATER = 3,
  /** 尚未开始练习 */
  NEW = 4,
  /** 已完成全部复习轮次，视为已掌握 */
  MASTERED = 5,
}

export interface Prediction {
  /** 所属文章 uuid（原 Kotlin 为 Long articleId） */
  articleId: string;
  title: string;
  urgency: Urgency;
  /** 应复习时间戳；未开始/已掌握为 0 */
  reviewDate: number;
  /** 距今天数：负数=已逾期，0=今天，正数=未来；未开始/已掌握为 Int.MAX_VALUE */
  daysLeft: number;
  practiceCount: number;
  /** 最近 N 次加权衰减正确率（越近权重越大），0-1 */
  lastAccuracy: number;
  /** 当前记忆留存率 R(Δt)，0-1 */
  retentionRate: number;
  /** 当前记忆强度 S（天） */
  memoryStrength: number;
  /** 未来 DECAY_CURVE_DAYS 天的留存率序列（index 0 = 今天） */
  decayCurve: number[];
}

/** 单条记录正确率（totalBlanks<=0 时为 1） */
function accuracyOf(r: PracticeRecordEntity): number {
  return r.totalBlanks > 0 ? r.correctCount / r.totalBlanks : 1;
}

/**
 * 记忆强度估算 S（天）。
 * ```
 * S_1 = 1
 * S_{n+1} = S_n × (1 + g × a_n)   当 a_n ≥ 0.3
 * S_{n+1} = S_n                   当 a_n < 0.3（未掌握，不增长）
 * ```
 */
function memoryStrength(records: PracticeRecordEntity[]): number {
  if (records.length === 0) return 0;
  const sorted = records.slice().sort((a, b) => a.timestamp - b.timestamp);
  let s = INITIAL_STRENGTH_DAYS;
  // 从第二次练习开始累加稳定性增长（首次仅设定 S_1）
  for (let i = 1; i < sorted.length; i++) {
    const acc = accuracyOf(sorted[i]);
    if (acc >= UNMASTERED_THRESHOLD) {
      s *= 1 + STRENGTH_GAIN * acc;
    }
  }
  return s;
}

/** 留存率 R(Δt) = e^(-Δt/S)，clamp 到 [0, 1] */
function retentionRateOf(strength: number, deltaDays: number): number {
  if (strength <= 0) return 0;
  const r = Math.exp(-deltaDays / strength);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/** 两条时间戳相差的天数（浮点） */
function daysSince(timestamp: number, now: number): number {
  return (now - timestamp) / MILLIS_PER_DAY;
}

/** 构建未来 DECAY_CURVE_DAYS 天的留存率序列，index 0 = 今天 */
function buildDecayCurve(strength: number, now: number, lastStudyTime: number): number[] {
  if (strength <= 0) return [];
  const elapsedDays = daysSince(lastStudyTime, now);
  const out: number[] = [];
  for (let dayOffset = 0; dayOffset <= DECAY_CURVE_DAYS; dayOffset++) {
    out.push(retentionRateOf(strength, elapsedDays + dayOffset));
  }
  return out;
}

/**
 * 加权衰减正确率：最近 5 次练习，越近权重越大（权重 5,4,3,2,1；不足 5 次仍单调递减）。
 */
function weightedAccuracy(records: PracticeRecordEntity[]): number {
  if (records.length === 0) return 0;
  const recent = records.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  let weightSum = 0;
  let accSum = 0;
  recent.forEach((r, i) => {
    const w = recent.length - i;
    accSum += accuracyOf(r) * w;
    weightSum += w;
  });
  return weightSum > 0 ? accSum / weightSum : 0;
}

export const ForgettingPredictor = {
  Urgency,

  /**
   * 生成所有文章的遗忘预测列表，按紧急度排序。
   *
   * @param articles  所有文章
   * @param allRecords 所有练习记录
   * @param template  复习模板（仅 FSRS 状态缺失时兜底使用）
   * @param fsrsStates 各文章的 FSRS 记忆状态（存在时完全采用 FSRS 自适应调度）
   */
  predict(
    articles: ArticleEntity[],
    allRecords: PracticeRecordEntity[],
    template: ReviewTemplate = ReviewTemplate.STANDARD,
    fsrsStates: Map<string, CardState> = new Map<string, CardState>(),
    now: number = Date.now(),
  ): Prediction[] {
    // O(records) 一次分组，避免 O(articles × records) 重复全量过滤
    const recordsByArticle = new Map<string, PracticeRecordEntity[]>();
    for (const r of allRecords) {
      const list = recordsByArticle.get(r.articleUuid);
      if (list) list.push(r);
      else recordsByArticle.set(r.articleUuid, [r]);
    }

    const out = articles.map((article): Prediction => {
      const records = (recordsByArticle.get(article.uuid) ?? []).slice()
        .sort((a, b) => a.timestamp - b.timestamp);

      // FSRS 状态优先：已由 FSRS 调度的文章不再走模板间隔
      const fsrsState = fsrsStates.get(article.uuid);
      if (fsrsState !== undefined && fsrsState.reviewCount > 0) {
        const diffMs = fsrsState.due - now;
        const daysLeft = kotlinToInt(Math.ceil(diffMs / MILLIS_PER_DAY));
        const urgency = diffMs < -MILLIS_PER_DAY ? Urgency.OVERDUE
          : diffMs <= 0 ? Urgency.TODAY
            : daysLeft <= 3 ? Urgency.SOON
              : Urgency.LATER;
        const s = fsrsState.stability;
        const r = FsrsEngine.retentionRate(fsrsState, now);
        return {
          articleId: article.uuid, title: article.title, urgency,
          reviewDate: fsrsState.due, daysLeft,
          practiceCount: fsrsState.reviewCount,
          lastAccuracy: weightedAccuracy(records),
          retentionRate: r, memoryStrength: s,
          // FSRS-6 幂律曲线逐日采样（与当前留存率同口径，避免点线不一致）
          decayCurve: Array.from({ length: DECAY_CURVE_DAYS + 1 }, (_v, dayOffset) =>
            FsrsEngine.retentionRate(fsrsState, now + dayOffset * MILLIS_PER_DAY)),
        };
      }

      // ── 模板兜底（无 FSRS 状态：升级前存量练习 / 从未练习）──
      // 按天去重计算复习轮次：同一天多次练习只算一次，避免重做污染 MASTERED 判定
      const dayKeys = new Set<string>();
      for (const r of records) dayKeys.add(localDayKey(r.timestamp));
      const count = dayKeys.size;

      if (records.length === 0) {
        return {
          articleId: article.uuid, title: article.title, urgency: Urgency.NEW,
          reviewDate: 0, daysLeft: INT_MAX, practiceCount: 0,
          lastAccuracy: 0, retentionRate: 0, memoryStrength: 0,
          decayCurve: [],
        };
      }
      const lastTime = records[records.length - 1].timestamp;
      if (count >= template.intervals.length) {
        // 已完成全部复习轮次：视为已掌握，留存率按模型实时估算（仍会随时间衰减）
        const s = memoryStrength(records);
        const r = retentionRateOf(s, daysSince(lastTime, now));
        return {
          articleId: article.uuid, title: article.title, urgency: Urgency.MASTERED,
          reviewDate: 0, daysLeft: INT_MAX, practiceCount: count,
          lastAccuracy: weightedAccuracy(records),
          retentionRate: r, memoryStrength: s,
          decayCurve: buildDecayCurve(s, now, lastTime),
        };
      }

      const acc = weightedAccuracy(records);
      const reviewDate = EbbinghausScheduler.nextReviewTime(template, count - 1, lastTime, acc) ?? 0;

      if (reviewDate === 0) {
        const s = memoryStrength(records);
        return {
          articleId: article.uuid, title: article.title, urgency: Urgency.MASTERED,
          reviewDate: 0, daysLeft: INT_MAX, practiceCount: count,
          lastAccuracy: acc,
          retentionRate: retentionRateOf(s, daysSince(lastTime, now)),
          memoryStrength: s,
          decayCurve: buildDecayCurve(s, now, lastTime),
        };
      }

      const diffMs = reviewDate - now;
      const daysLeft = kotlinToInt(Math.ceil(diffMs / MILLIS_PER_DAY));
      const s = memoryStrength(records);
      const r = retentionRateOf(s, daysSince(lastTime, now));
      // 修复：diffMs <= 0（含恰好今天到期与已过期不足 1 天）统一为 TODAY
      const urgency = diffMs < -MILLIS_PER_DAY ? Urgency.OVERDUE
        : diffMs <= 0 ? Urgency.TODAY
          : daysLeft <= 3 ? Urgency.SOON
            : Urgency.LATER;
      return {
        articleId: article.uuid, title: article.title, urgency,
        reviewDate, daysLeft, practiceCount: count,
        lastAccuracy: acc, retentionRate: r, memoryStrength: s,
        decayCurve: buildDecayCurve(s, now, lastTime),
      };
    });

    // 已逾期/今天到期在前，同紧急度内按应复习时间升序（越早到期越前）
    out.sort((a, b) => (a.urgency - b.urgency) || (a.reviewDate - b.reviewDate));
    return out;
  },

  /** 仅返回需要尽快复习的文章（逾期 + 今天 + 3 天内） */
  dueSoon(predictions: Prediction[]): Prediction[] {
    return predictions.filter((p) =>
      p.urgency === Urgency.OVERDUE || p.urgency === Urgency.TODAY || p.urgency === Urgency.SOON);
  },
};