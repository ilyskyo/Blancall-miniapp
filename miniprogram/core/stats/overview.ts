/**
 * 统计聚合（对应 Android 端 OverviewScreen / StatisticsScreen 的口径）
 *
 * 说明：所有指标都从本地记录/FSRS 计算；学习时长与排行榜共用 study_stat。
 */

import { SentenceSplitter } from '../algorithms/sentence';
import { AchievementManager, Achievement } from '../algorithms/achievement';
import { ForgettingPredictor, Prediction } from '../algorithms/forgetting';
import { FsrsEngine } from '../algorithms/fsrs';
import { currentReviewTemplate } from '../review/template';
import { PracticeMode, PracticeRecordEntity } from '../algorithms/types';
import { articleStore, recordStore, recordsOfArticle, studyStatStore, tagsOfArticle, tagStore, allFsrs, getFsrs } from '../storage/entities';
import { dateKey, lastNDays, startOfDay, MILLIS_PER_DAY, formatDuration } from '../utils/date';

export interface GlobalStats {
  /** 总体正确率 0..1 */
  accuracy: number;
  /** 练习次数 */
  practiceCount: number;
  /** 涉及文章数 */
  articleCount: number;
  /** 总填空数 */
  totalBlanks: number;
  /** 累计学习时长（秒）＝练习 + 阅读 */
  studySeconds: number;
  /** 累计阅读时长（秒） */
  readingSeconds: number;
  /** 连续学习天数 / 最长 */
  streak: number;
  longestStreak: number;
  /** 今日练习次数 / 今日学习秒数 */
  todayCount: number;
  todaySeconds: number;
  /** 历史最佳单次正确率 */
  bestAccuracy: number;
  /** 最近一次练习时间 */
  lastPracticeAt: number;
}

/** 学习日集合（练习或阅读 ≥1 分钟才算当日有效） */
function activeDays(): Set<string> {
  const days = new Set<string>();
  for (const s of studyStatStore.list()) {
    if ((s.practiceSeconds || 0) + (s.readingSeconds || 0) >= 60) days.add(s.date);
  }
  for (const r of recordStore.list()) days.add(dateKey(r.timestamp));
  return days;
}

function computeStreaks(): { streak: number; longest: number } {
  const days = Array.from(activeDays()).sort();
  if (days.length === 0) return { streak: 0, longest: 0 };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(`${days[i - 1]}T00:00:00`).getTime();
    const cur = new Date(`${days[i]}T00:00:00`).getTime();
    if (Math.round((cur - prev) / MILLIS_PER_DAY) === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
  }
  // 当前连续：从今天或昨天往前推
  const today = dateKey();
  const yesterday = dateKey(Date.now() - MILLIS_PER_DAY);
  let streak = 0;
  if (days.includes(today) || days.includes(yesterday)) {
    let cursor = days.includes(today) ? today : yesterday;
    while (days.includes(cursor)) {
      streak += 1;
      cursor = dateKey(new Date(`${cursor}T00:00:00`).getTime() - MILLIS_PER_DAY);
    }
  }
  return { streak, longest };
}

export function globalStats(): GlobalStats {
  const records = recordStore.list();
  const totalBlanks = records.reduce((s, r) => s + r.totalBlanks, 0);
  const totalCorrect = records.reduce((s, r) => s + r.correctCount, 0);
  const practiceSeconds = records.reduce((s, r) => s + Math.round((r.duration || 0) / 1000), 0);
  const readingSeconds = studyStatStore.list().reduce((s, it) => s + (it.readingSeconds || 0), 0);
  const { streak, longest } = computeStreaks();
  const today = dateKey();
  const todayRecords = records.filter((r) => dateKey(r.timestamp) === today);
  const articleIds = new Set(records.map((r) => r.articleUuid));

  const todayStat = studyStatStore.find(today);
  return {
    accuracy: totalBlanks > 0 ? totalCorrect / totalBlanks : 0,
    practiceCount: records.length,
    articleCount: articleIds.size,
    totalBlanks,
    studySeconds: practiceSeconds + readingSeconds,
    readingSeconds,
    streak,
    longestStreak: longest,
    todayCount: todayRecords.length,
    todaySeconds: todayStat ? (todayStat.practiceSeconds || 0) + (todayStat.readingSeconds || 0) : 0,
    bestAccuracy: records.reduce((best, r) => (r.totalBlanks > 0 ? Math.max(best, r.correctCount / r.totalBlanks) : best), 0),
    lastPracticeAt: records.reduce((last, r) => Math.max(last, r.timestamp), 0),
  };
}

/** 每日练习趋势（近 N 天：次数 + 正确率） */
export function dailyTrend(days = 14): Array<{ date: string; label: string; count: number; accuracy: number; seconds: number }> {
  const keys = lastNDays(days);
  const records = recordStore.list();
  const stats = studyStatStore.list();
  return keys.map((date) => {
    const dayRecords = records.filter((r) => dateKey(r.timestamp) === date);
    const blanks = dayRecords.reduce((s, r) => s + r.totalBlanks, 0);
    const correct = dayRecords.reduce((s, r) => s + r.correctCount, 0);
    const stat = stats.find((s) => s.date === date);
    return {
      date,
      label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
      count: dayRecords.length,
      accuracy: blanks > 0 ? correct / blanks : 0,
      seconds: stat ? (stat.practiceSeconds || 0) + (stat.readingSeconds || 0) : 0,
    };
  });
}

/** 学习日历（近 N 天：是否有学习行为） */
export function calendar(days = 84): Array<{ date: string; active: boolean; seconds: number }> {
  const keys = lastNDays(days);
  const stats = new Map(studyStatStore.list().map((s) => [s.date, s] as const));
  const records = recordStore.list();
  const recordDays = new Set(records.map((r) => dateKey(r.timestamp)));
  return keys.map((date) => {
    const stat = stats.get(date);
    const seconds = stat ? (stat.practiceSeconds || 0) + (stat.readingSeconds || 0) : 0;
    return { date, active: seconds > 0 || recordDays.has(date), seconds };
  });
}

/** 弱点画像（错误类型占比） */
export function weaknessProfile(): Array<{ type: string; label: string; count: number; ratio: number }> {
  const records = recordStore.list();
  const counter: Record<string, number> = { TYPO: 0, MISSING: 0, EXTRA: 0, WRONG_ORDER: 0 };
  for (const r of records) for (const m of r.mistakes) counter[m.errorType] = (counter[m.errorType] || 0) + 1;
  const total = Object.values(counter).reduce((s, v) => s + v, 0);
  const label: Record<string, string> = { TYPO: '错别字', MISSING: '漏字', EXTRA: '多填', WRONG_ORDER: '顺序错' };
  return Object.keys(counter).map((type) => ({
    type,
    label: label[type] || type,
    count: counter[type],
    ratio: total > 0 ? counter[type] / total : 0,
  }));
}

/** 模式对比 */
export function modeComparison(): Array<{ mode: PracticeMode; label: string; count: number; accuracy: number }> {
  const records = recordStore.list();
  const label: Record<PracticeMode, string> = { SENTENCE: '句子挖空', WORD: '字词挖空', REVERSE: '反向默写' };
  const modes: PracticeMode[] = ['SENTENCE', 'WORD', 'REVERSE'];
  return modes.map((mode) => {
    const list = records.filter((r) => r.mode === mode);
    const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
    const correct = list.reduce((s, r) => s + r.correctCount, 0);
    return { mode, label: label[mode], count: list.length, accuracy: blanks > 0 ? correct / blanks : 0 };
  });
}

/** 进步趋势：近 7 天 vs 更早（±5% 判定） */
export function progressTrend(): { recent: number; earlier: number; delta: number; trend: 'up' | 'down' | 'flat' } {
  const records = recordStore.list();
  const since = startOfDay(Date.now() - 6 * MILLIS_PER_DAY);
  const recent = records.filter((r) => r.timestamp >= since);
  const earlier = records.filter((r) => r.timestamp < since);
  const acc = (list: PracticeRecordEntity[]): number => {
    const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
    const correct = list.reduce((s, r) => s + r.correctCount, 0);
    return blanks > 0 ? correct / blanks : 0;
  };
  const a = acc(recent);
  const b = acc(earlier);
  const delta = a - b;
  return { recent: a, earlier: b, delta, trend: delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat' };
}

/** 需加强的文章（正确率最低的前 3 篇，仅统计练习次数 ≥1 的文章） */
export function weakestArticles(limit = 3): Array<{ articleUuid: string; title: string; accuracy: number; count: number }> {
  const records = recordStore.list();
  const byArticle = new Map<string, PracticeRecordEntity[]>();
  for (const r of records) {
    const list = byArticle.get(r.articleUuid) || [];
    list.push(r);
    byArticle.set(r.articleUuid, list);
  }
  const out: Array<{ articleUuid: string; title: string; accuracy: number; count: number }> = [];
  byArticle.forEach((list, articleUuid) => {
    const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
    const correct = list.reduce((s, r) => s + r.correctCount, 0);
    const article = articleStore.find(articleUuid);
    out.push({
      articleUuid,
      title: article ? article.title : '(已删除)',
      accuracy: blanks > 0 ? correct / blanks : 0,
      count: list.length,
    });
  });
  return out.sort((a, b) => a.accuracy - b.accuracy).slice(0, limit);
}

/** 单篇统计 */
export function articleStats(articleUuid: string): {
  accuracy: number;
  count: number;
  bestAccuracy: number;
  lastAt: number;
  totalCorrect: number;
  streak: number;
} {
  // 走按文章索引（O(1)），避免每篇文章一次全量记录扫描
  const records = recordsOfArticle(articleUuid);
  const blanks = records.reduce((s, r) => s + r.totalBlanks, 0);
  const correct = records.reduce((s, r) => s + r.correctCount, 0);
  const days = new Set(records.map((r) => dateKey(r.timestamp)));
  return {
    accuracy: blanks > 0 ? correct / blanks : 0,
    count: records.length,
    bestAccuracy: records.reduce((best, r) => (r.totalBlanks > 0 ? Math.max(best, r.correctCount / r.totalBlanks) : best), 0),
    lastAt: records.reduce((last, r) => Math.max(last, r.timestamp), 0),
    totalCorrect: correct,
    streak: days.size,
  };
}

/** 句子记忆概览 */
export function sentenceMemory(): {
  remembered: number;
  totalReviews: number;
  forgettingRate: number;
  avgRetention: number;
  dueToday: number;
} {
  const states = allFsrs().filter((s) => s.key.startsWith('s:'));
  const totalReviews = states.reduce((s, it) => s + (it.reviewCount || 0), 0);
  const lapses = states.reduce((s, it) => s + (it.lapses || 0), 0);
  const now = Date.now();
  const retentions = states.map((s) => FsrsEngine.retentionRate(s, now));
  return {
    remembered: states.length,
    totalReviews,
    forgettingRate: totalReviews > 0 ? lapses / totalReviews : 0,
    avgRetention: retentions.length > 0 ? retentions.reduce((s, v) => s + v, 0) / retentions.length : 0,
    dueToday: states.filter((s) => s.due <= now).length,
  };
}

/** 即将遗忘（逾期 + 今天 + 3 天内，取前 N） */
export function dueSoon(limit = 5): Prediction[] {
  const articles = articleStore.list();
  if (articles.length === 0) return [];
  const records = recordStore.list();
  const articleStates = new Map<string, NonNullable<ReturnType<typeof getFsrs>>>();
  for (const s of allFsrs()) {
    if (!s.key.startsWith('s:')) articleStates.set(s.key, s);
  }
  // 使用用户所选复习模板（无 FSRS 状态时的间隔兜底；FSRS 存在时目标留存率已在启动时配置）
  const predictions = ForgettingPredictor.predict(articles, records, currentReviewTemplate(), articleStates as never);
  return ForgettingPredictor.dueSoon(predictions).slice(0, limit);
}

/** 成就（11 项） */
export function achievements(): Achievement[] {
  const stats = globalStats();
  return AchievementManager.evaluate(recordStore.list(), stats.longestStreak, stats.streak);
}

/** 标签分布 */
export function tagDistribution(): Array<{ name: string; count: number; color: number }> {
  const articles = articleStore.list();
  const counter = new Map<string, number>();
  for (const a of articles) {
    for (const t of tagsOfArticle(a.uuid)) counter.set(t.name, (counter.get(t.name) || 0) + 1);
  }
  const out: Array<{ name: string; count: number; color: number }> = [];
  for (const t of tagStore.list()) {
    out.push({ name: t.name, color: t.color, count: counter.get(t.name) || 0 });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** 阅读时长格式化（供 UI 直接展示） */
export function formatStudy(seconds: number): string {
  return formatDuration(seconds);
}