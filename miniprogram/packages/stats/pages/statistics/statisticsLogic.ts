/**
 * 单篇统计辅助逻辑（趋势 / 模式对比 / 薄弱环节 / 热力图 / 练习历史）
 * 口径：全部基于该篇的本地练习记录。
 */

import { PracticeRecordEntity, PracticeMode, ErrorType } from '../../../../core/algorithms/types';
import { HeatmapData, MemoryHeatmap } from '../../../../core/algorithms/memoryHeatmap';
import { dateKey, formatMillis, lastNDays } from '../../../../core/utils/date';

export const MODE_LABEL: Record<PracticeMode, string> = {
  SENTENCE: '句子挖空',
  WORD: '字词挖空',
  REVERSE: '反向默写',
};

const ERROR_LABEL: Record<ErrorType, string> = {
  TYPO: '错别字',
  MISSING: '漏字',
  EXTRA: '多填',
  WRONG_ORDER: '顺序错',
};

export interface TrendBar {
  date: string;
  label: string;
  count: number;
  heightPercent: number;
  valueText: string;
}

/** 近 N 天训练趋势（按该篇记录） */
export function buildTrend(records: PracticeRecordEntity[], days = 14): TrendBar[] {
  const keys = lastNDays(days);
  const counts = keys.map((date) => records.filter((r) => dateKey(r.timestamp) === date).length);
  const max = counts.reduce((m, c) => Math.max(m, c), 0);
  return keys.map((date, i) => {
    const count = counts[i];
    const heightPercent = max > 0 ? Math.max(count > 0 ? 8 : 0, Math.round((count / max) * 100)) : 0;
    return {
      date,
      label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
      count,
      heightPercent,
      valueText: count > 0 ? `${count}` : '',
    };
  });
}

export interface ModeRow {
  mode: PracticeMode;
  label: string;
  count: number;
  accuracyPercent: number;
  accuracyText: string;
}

/** 模式对比（该篇） */
export function buildModes(records: PracticeRecordEntity[]): ModeRow[] {
  const modes: PracticeMode[] = ['SENTENCE', 'WORD', 'REVERSE'];
  return modes.map((mode) => {
    const list = records.filter((r) => r.mode === mode);
    const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
    const correct = list.reduce((s, r) => s + r.correctCount, 0);
    const acc = blanks > 0 ? correct / blanks : 0;
    return {
      mode,
      label: MODE_LABEL[mode],
      count: list.length,
      accuracyPercent: Math.round(acc * 100),
      accuracyText: list.length > 0 ? `${Math.round(acc * 100)}%` : '—',
    };
  });
}

export interface WeakRow {
  label: string;
  count: number;
  ratioText: string;
}

/** 薄弱环节（该篇错误类型分布） */
export function buildWeakness(records: PracticeRecordEntity[]): WeakRow[] {
  const counter: Record<string, number> = { TYPO: 0, MISSING: 0, EXTRA: 0, WRONG_ORDER: 0 };
  for (const r of records) for (const m of r.mistakes) counter[m.errorType] = (counter[m.errorType] || 0) + 1;
  const total = Object.values(counter).reduce((s, v) => s + v, 0);
  const order: ErrorType[] = ['TYPO', 'MISSING', 'EXTRA', 'WRONG_ORDER'];
  if (total === 0) return [];
  return order
    .filter((t) => counter[t] > 0)
    .map((t) => ({
      label: ERROR_LABEL[t],
      count: counter[t],
      ratioText: `${Math.round((counter[t] / total) * 100)}%`,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface HeatCell {
  key: string;
  text: string;
  /** '#RRGGBB' 或 ''（未练习） */
  color: string;
  /** 内联背景样式（未练习为空） */
  bgStyle: string;
  errorText: string;
}

export interface HeatResult {
  cells: HeatCell[];
  overallErrorText: string;
  hasHistory: boolean;
}

/** 记忆热力图（按句），未练习句无色 */
export function buildHeat(content: string, records: PracticeRecordEntity[]): HeatResult {
  if (!content) return { cells: [], overallErrorText: '—', hasHistory: false };
  const data: HeatmapData = MemoryHeatmap.generate(content, records);
  const cells: HeatCell[] = data.sentences.map((s) => ({
    key: `s${s.sentenceIndex}`,
    text: s.text,
    color: s.heatColor,
    bgStyle: s.heatColor ? `background:${s.heatColor}` : '',
    errorText: s.heatColor ? `${Math.round(s.errorRate * 100)}%` : '未练',
  }));
  return {
    cells,
    overallErrorText: `${Math.round(data.overallErrorRate * 100)}%`,
    hasHistory: data.totalPractices > 0,
  };
}

export interface MistakeItem {
  index: number;
  correct: string;
  user: string;
  label: string;
}

export interface HistoryRow {
  uuid: string;
  timeText: string;
  modeLabel: string;
  accuracyText: string;
  correctText: string;
  durationText: string;
  mistakeCount: number;
  mistakes: MistakeItem[];
  expanded: boolean;
}

/** 练习历史（该篇，按时间倒序；filter 为 ALL 或某个模式） */
export function buildHistory(records: PracticeRecordEntity[], filter: string, expanded: Record<string, boolean>): HistoryRow[] {
  return records
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((r) => filter === 'ALL' || r.mode === filter)
    .map((r) => {
      const acc = r.totalBlanks > 0 ? r.correctCount / r.totalBlanks : 0;
      return {
        uuid: r.uuid,
        timeText: formatMillisDate(r.timestamp),
        modeLabel: MODE_LABEL[r.mode],
        accuracyText: `${Math.round(acc * 100)}%`,
        correctText: `${r.correctCount}/${r.totalBlanks}`,
        durationText: r.duration > 0 ? formatMillis(r.duration) : '—',
        mistakeCount: r.mistakes.length,
        mistakes: r.mistakes.map((m) => ({
          index: m.blankIndex + 1,
          correct: m.correctAnswer,
          user: m.userAnswer || '（空）',
          label: ERROR_LABEL[m.errorType],
        })),
        expanded: !!expanded[r.uuid],
      };
    });
}

function formatMillisDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 热力图图例 */
export function heatLegend(): Array<{ label: string; color: string }> {
  return MemoryHeatmap.getLegendColors().map(([label, color]) => ({ label, color }));
}