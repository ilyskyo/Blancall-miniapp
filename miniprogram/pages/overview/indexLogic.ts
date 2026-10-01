/**
 * 数据总览辅助逻辑：统计口径整形 + （雷达）canvas 2D 自绘
 * WXML 不支持函数调用，所有派生数据在此算好。
 */

import {
  achievements,
  calendar,
  dailyTrend,
  dueSoon,
  globalStats,
  modeComparison,
  progressTrend,
  sentenceMemory,
  tagDistribution,
  weakestArticles,
  weaknessProfile,
} from '../../core/stats/overview';
import { Urgency, Prediction } from '../../core/algorithms/forgetting';
import { getSettings } from '../../core/storage/prefs';
import { currentTheme } from '../../core/theme/theme';
import { formatDuration } from '../../core/utils/date';

export interface TrendBar {
  label: string;
  count: number;
  heightPercent: number;
  accuracyPercent: number;
}

export interface CalendarCell {
  key: string;
  blank: boolean;
  active: boolean;
  level: number;
}

export interface CalendarWeek {
  k: string;
  days: CalendarCell[];
}

export interface DueItem {
  articleUuid: string;
  title: string;
  urgencyLabel: string;
  urgencyClass: string;
  daysText: string;
  retentionPercent: number;
}

export interface ModeItem {
  label: string;
  count: number;
  accuracyPercent: number;
}

export interface AchItem {
  id: string;
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
  progressPercent: number;
  progressText: string;
}

export interface WeakArticleItem {
  articleUuid: string;
  title: string;
  accuracyPercent: number;
}

export interface WeakPoint {
  label: string;
  ratioPercent: number;
}

export interface TagItem {
  name: string;
  count: number;
  colorIndex: number;
}

export interface OverviewView {
  accuracyPercent: number;
  accuracyRing: string;
  streak: number;
  longestStreak: number;
  studyText: string;
  readingText: string;
  practiceCount: number;
  articleCount: number;
  totalBlanks: number;
  todayGoal: number;
  todayDone: number;
  todayPercent: number;
  due: DueItem[];
  sentence: {
    remembered: number;
    totalReviews: number;
    forgettingPercent: number;
    avgRetentionPercent: number;
    dueToday: number;
  };
  trend: TrendBar[];
  calendarWeeks: CalendarWeek[];
  weakness: WeakPoint[];
  radarLabels: string[];
  radarValues: number[];
  modes: ModeItem[];
  progressLabel: string;
  progressDeltaText: string;
  progressClass: string;
  achievements: AchItem[];
  weakest: WeakArticleItem[];
  tags: TagItem[];
  hasData: boolean;
}

function pct(v: number): number {
  return Math.round(v * 100);
}

/** 紧急度 → 文案与样式类 */
function urgencyOf(p: Prediction): { label: string; klass: string; days: string } {
  if (p.urgency === Urgency.OVERDUE) {
    const d = p.daysLeft < 0 ? -p.daysLeft : 1;
    return { label: '已逾期', klass: 'u-overdue', days: `逾期 ${d} 天` };
  }
  if (p.urgency === Urgency.TODAY) return { label: '今天', klass: 'u-today', days: '今天应复习' };
  return { label: '即将', klass: 'u-soon', days: `${Math.max(0, p.daysLeft)} 天后` };
}

/** 构建近 84 天日历（按周分列，行 = 周内日） */
function buildCalendarWeeks(): CalendarWeek[] {
  const days = calendar(84);
  if (days.length === 0) return [];
  const first = new Date(`${days[0].date}T00:00:00`).getDay(); // 0=周日
  const cells: CalendarCell[] = [];
  for (let i = 0; i < first; i++) cells.push({ key: `pad${i}`, blank: true, active: false, level: 0 });
  for (const d of days) {
    const level = d.seconds >= 1800 ? 4 : d.seconds >= 900 ? 3 : d.seconds >= 300 ? 2 : d.seconds > 0 ? 1 : 0;
    cells.push({ key: d.date, blank: false, active: d.active, level });
  }
  while (cells.length % 7 !== 0) cells.push({ key: `tail${cells.length}`, blank: true, active: false, level: 0 });
  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push({ k: `w${i / 7}`, days: cells.slice(i, i + 7) });
  return weeks;
}

/** 聚合总览数据 */
export function buildOverview(): OverviewView {
  const s = globalStats();
  const goal = getSettings().dailyPracticeGoal || 3;
  const accuracyPercent = pct(s.accuracy);
  const todayDone = s.todayCount;
  const todayPercent = goal > 0 ? Math.min(100, Math.round((todayDone / goal) * 100)) : 0;

  const due = dueSoon(5).map((p): DueItem => {
    const u = urgencyOf(p);
    return {
      articleUuid: p.articleId,
      title: p.title,
      urgencyLabel: u.label,
      urgencyClass: u.klass,
      daysText: u.days,
      retentionPercent: pct(p.retentionRate),
    };
  });

  const sm = sentenceMemory();

  const rawTrend = dailyTrend(14);
  const maxCount = rawTrend.reduce((m, t) => Math.max(m, t.count), 0);
  const trend: TrendBar[] = rawTrend.map((t) => ({
    label: t.label,
    count: t.count,
    heightPercent: maxCount > 0 ? Math.max(t.count > 0 ? 6 : 0, Math.round((t.count / maxCount) * 100)) : 0,
    accuracyPercent: pct(t.accuracy),
  }));

  const weak = weaknessProfile();
  const progress = progressTrend();

  const modes: ModeItem[] = modeComparison().map((m) => ({
    label: m.label,
    count: m.count,
    accuracyPercent: pct(m.accuracy),
  }));

  const ach: AchItem[] = achievements().map((a) => ({
    id: a.id,
    icon: a.icon,
    title: a.title,
    description: a.description,
    unlocked: a.unlocked,
    progressPercent: Math.round(a.progress * 100),
    progressText: a.progressText,
  }));

  const weakest: WeakArticleItem[] = weakestArticles(3).map((w) => ({
    articleUuid: w.articleUuid,
    title: w.title,
    accuracyPercent: pct(w.accuracy),
  }));

  const tags: TagItem[] = tagDistribution()
    .slice(0, 12)
    .map((t) => ({ name: t.name, count: t.count, colorIndex: ((t.color % 6) + 6) % 6 }));

  const progressLabel = progress.trend === 'up' ? '稳步进步' : progress.trend === 'down' ? '略有退步' : '基本持平';
  const deltaSign = progress.delta > 0 ? '+' : '';
  const progressClass = progress.trend === 'up' ? 'trend-up' : progress.trend === 'down' ? 'trend-down' : 'trend-flat';

  const accuracyRing = `background: conic-gradient(var(--accent) 0 ${accuracyPercent}%, var(--border) ${accuracyPercent}% 100%)`;

  return {
    accuracyPercent,
    accuracyRing,
    streak: s.streak,
    longestStreak: s.longestStreak,
    studyText: formatDuration(s.studySeconds),
    readingText: formatDuration(s.readingSeconds),
    practiceCount: s.practiceCount,
    articleCount: s.articleCount,
    totalBlanks: s.totalBlanks,
    todayGoal: goal,
    todayDone,
    todayPercent,
    due,
    sentence: {
      remembered: sm.remembered,
      totalReviews: sm.totalReviews,
      forgettingPercent: pct(sm.forgettingRate),
      avgRetentionPercent: pct(sm.avgRetention),
      dueToday: sm.dueToday,
    },
    trend,
    calendarWeeks: buildCalendarWeeks(),
    weakness: weak.map((w) => ({ label: w.label, ratioPercent: pct(w.ratio) })),
    radarLabels: weak.map((w) => w.label),
    radarValues: weak.map((w) => w.ratio),
    modes,
    progressLabel,
    progressDeltaText: `${deltaSign}${(progress.delta * 100).toFixed(1)}%`,
    progressClass,
    achievements: ach,
    weakest,
    tags,
    hasData: s.practiceCount > 0,
  };
}

/** 读取最近一次 AI 训练分析（由 AI 分包写入；不存在则隐藏卡片） */
export function readLastAnalysis(): { title: string; markdown: string } | null {
  try {
    const raw = wx.getStorageSync('last_analysis');
    if (!raw) return null;
    if (typeof raw === 'string') return raw.trim() ? { title: '最近训练分析', markdown: raw } : null;
    const obj = raw as { markdown?: string; text?: string; title?: string };
    const markdown = obj.markdown || obj.text || '';
    return markdown ? { title: obj.title || '最近训练分析', markdown } : null;
  } catch {
    return null;
  }
}

/**
 * canvas 2D 绘制弱点雷达（4 轴：错字/漏字/多填/乱序）。
 * 颜色取自主题模块，避免硬编码。
 */
export function drawRadar(canvas: any, width: number, height: number, dpr: number, values: number[], labels: string[]): void {
  if (!canvas || !width || !height) return;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const t = currentTheme();
  const n = values.length;
  if (n < 3) return;

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 26;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, r: number): { x: number; y: number } => ({
    x: cx + Math.cos(angle(i)) * r,
    y: cy + Math.sin(angle(i)) * r,
  });

  // 网格环
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.border;
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = point(i, (radius * ring) / 4);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // 轴线
  for (let i = 0; i < n; i++) {
    const p = point(i, radius);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  // 数据多边形
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(1, values[i] || 0));
    const p = point(i, radius * Math.max(0.04, v));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = t.accentSoft;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.accent;
  ctx.stroke();

  // 标签
  ctx.fillStyle = t.textSecondary;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const p = point(i, radius + 14);
    ctx.fillText(labels[i] || '', p.x, p.y);
  }
}

export type { Prediction };