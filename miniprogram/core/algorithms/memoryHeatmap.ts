// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT
//
// 记忆热力图生成器（F5）
// 对应 Kotlin `com.ilyskyo.blancall.algorithm.MemoryHeatmap`。
//
// 从练习记录中提取每个句子的错误率，映射为暖色→冷色渐变：
// - 暖色（红/橙）：经常出错，记忆薄弱
// - 冷色（绿）：掌握牢固
// - 无色：从未练习过
//
// 移植说明：Android `androidx.compose.ui.graphics.Color` → TS 十六进制字符串 '#RRGGBB'；
// `Color.Unspecified` → 空字符串 ''（UI 侧据此判定「无色/未练习」，不画热力底色）。

import { SentenceSplitter } from './sentence';
import type { MistakeDetail, PracticeRecordEntity } from './types';

// 错误率→颜色 阈值常量（从高到低，避免魔法数字散落）
const THRESHOLD_HIGH = 0.7; // ≥0.7 深红：薄弱
const THRESHOLD_MEDIUM_HIGH = 0.5; // ≥0.5 橙：较难
const THRESHOLD_MEDIUM = 0.3; // ≥0.3 黄：一般
const THRESHOLD_LOW = 0.1; // ≥0.1 浅绿：熟悉

// 颜色常量（Compose Color(0xFF……) → '#RRGGBB'）
const COLOR_DEEP_RED = '#E53935';
const COLOR_ORANGE = '#EF6C00';
const COLOR_YELLOW = '#F9A825';
const COLOR_LIGHT_GREEN = '#7CB342';
const COLOR_DEEP_GREEN = '#43A047';
const COLOR_VIRIDIAN = '#66BB6A'; // 从未错过
/** Color.Unspecified：无色（未练习） */
const COLOR_UNSPECIFIED = '';

/** 单句热力数据（对应 Kotlin `MemoryHeatmap.SentenceHeat`） */
export interface SentenceHeat {
  sentenceIndex: number;
  text: string;
  /** 0-1，该句错误率 */
  errorRate: number;
  /** 练习次数（当前为整篇练习会话数，见下方注释） */
  practiceCount: number;
  /** 映射后的热力颜色（'#RRGGBB'，'' = 无色） */
  heatColor: string;
}

/** 整文热力图数据（对应 Kotlin `MemoryHeatmap.HeatmapData`） */
export interface HeatmapData {
  sentences: SentenceHeat[];
  overallErrorRate: number;
  totalPractices: number;
}

/** 错题 → 真实句子索引提供器；返回 null/undefined 时回退按 blankIndex 比例估算 */
export type SentenceIndexProvider = (mistake: MistakeDetail) => number | null | undefined;

function coerceIn(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * 错误率 → 颜色映射（阈值见上方常量）。
 * 0.0（无错误）→ 绿色；0.5（中等）→ 橙色；1.0（高错误）→ 红色。
 * 无历史（hasHistory=false）→ 无色 ''。
 */
function errorRateToColor(errorRate: number, hasHistory: boolean): string {
  if (!hasHistory) return COLOR_UNSPECIFIED;
  if (errorRate >= THRESHOLD_HIGH) return COLOR_DEEP_RED; // 深红
  if (errorRate >= THRESHOLD_MEDIUM_HIGH) return COLOR_ORANGE; // 橙
  if (errorRate >= THRESHOLD_MEDIUM) return COLOR_YELLOW; // 黄
  if (errorRate >= THRESHOLD_LOW) return COLOR_LIGHT_GREEN; // 浅绿
  if (errorRate > 0) return COLOR_DEEP_GREEN; // 深绿
  return COLOR_VIRIDIAN; // 翠绿（从未错过）
}

/** 获取热力渐变色带（用于图例） */
function getLegendColors(): Array<[string, string]> {
  return [
    ['薄弱', COLOR_DEEP_RED],
    ['较难', COLOR_ORANGE],
    ['一般', COLOR_YELLOW],
    ['熟悉', COLOR_LIGHT_GREEN],
    ['牢固', COLOR_DEEP_GREEN],
  ];
}

/**
 * 估算错题所属句子索引（回退方案）。
 * 由于空白索引是全局的，缺乏真实句子索引时按比例映射到句子。
 * 对应 Kotlin `estimateSentenceIndex`（ratio * totalSentences 用 toInt() 截断）。
 */
function estimateSentenceIndex(blankIndex: number, totalSentences: number, totalBlanks: number): number {
  if (totalSentences <= 0 || totalBlanks <= 0) return 0;
  const ratio = blankIndex / Math.max(totalBlanks, 1);
  return coerceIn(Math.trunc(ratio * totalSentences), 0, totalSentences - 1);
}

/**
 * 从练习记录生成整篇文章的热力图数据。
 * @param content 文章原文
 * @param records 该文章的所有练习记录
 * @param sentenceIndexProvider 错题→真实句子索引的提供器（缺省返回 null，回退比例估算）
 */
function generate(
  content: string,
  records: PracticeRecordEntity[],
  sentenceIndexProvider?: SentenceIndexProvider
): HeatmapData {
  const provider: SentenceIndexProvider = sentenceIndexProvider ?? (() => null);

  // 用带位置的切句作为唯一锚点：字符起始位置 → 句索引。
  // 练习记录存的是「句子在全文中的字符起始位置」（见 answeredSentenceStarts），
  // 不受「全文切句 vs 各段分别切句」口径差异影响。
  const positioned = SentenceSplitter.splitWithPositions(content);
  const allSentences = positioned.map((p) => p.text);
  if (allSentences.length === 0) {
    return { sentences: [], overallErrorRate: 0, totalPractices: 0 };
  }
  const startToIndex = new Map<number, number>();
  positioned.forEach((p, idx) => startToIndex.set(p.startIndex, idx));

  // sentenceErrors[sIdx] = errorCount；sentenceTotal[sIdx] = totalPracticeCount（按句近似）
  const sentenceErrors = new Map<number, number>();
  const sentenceTotal = new Map<number, number>();

  for (const record of records) {
    for (const mistake of record.mistakes) {
      // 优先用 provider 返回的真实句子索引；为空才回退比例估算
      const provided = provider(mistake);
      const sentIdx =
        provided !== null && provided !== undefined
          ? provided
          : estimateSentenceIndex(mistake.blankIndex, allSentences.length, record.totalBlanks);
      sentenceErrors.set(sentIdx, (sentenceErrors.get(sentIdx) ?? 0) + 1);
    }
    // 本次实际作答的句子：新记录按字符位置锚定（未完成提交被跳过的空不计入）；
    // 旧记录无该字段 → 回退整篇都练到。
    if (record.answeredSentenceStarts.length > 0) {
      for (const start of record.answeredSentenceStarts) {
        const sIdx = startToIndex.get(start);
        if (sIdx === undefined) continue;
        sentenceTotal.set(sIdx, (sentenceTotal.get(sIdx) ?? 0) + 1);
      }
    } else {
      const blanksPerSentence =
        allSentences.length > 0 ? Math.trunc(record.totalBlanks / Math.max(allSentences.length, 1)) : 1;
      for (let sIdx = 0; sIdx < allSentences.length; sIdx++) {
        sentenceTotal.set(sIdx, (sentenceTotal.get(sIdx) ?? 0) + Math.max(blanksPerSentence, 1));
      }
    }
  }

  const totalPractices = records.length;

  // 构建每句的热力数据。
  // 注意：practiceCount 当前取整篇练习会话数（records.length），每条记录都练到所有句子。
  const sentences: SentenceHeat[] = allSentences.map((text, idx) => {
    const errors = sentenceErrors.get(idx) ?? 0;
    const total = sentenceTotal.get(idx) ?? 0;
    // 未作答句（从未被练到）→ 未练习：无色
    const heatColor =
      total <= 0
        ? COLOR_UNSPECIFIED
        : errorRateToColor(coerceIn(errors / total, 0, 1), totalPractices > 0);
    const errorRate = total > 0 ? errors / Math.max(total, 1) : 0;
    return { sentenceIndex: idx, text, errorRate, practiceCount: totalPractices, heatColor };
  });

  let overallError = 0;
  if (records.length > 0) {
    let totalMistakes = 0;
    let totalBlanks = 0;
    for (const r of records) {
      totalMistakes += r.mistakes.length;
      totalBlanks += r.totalBlanks;
    }
    overallError = totalBlanks > 0 ? totalMistakes / totalBlanks : 0;
  }

  return { sentences, overallErrorRate: overallError, totalPractices };
}

export const MemoryHeatmap = {
  THRESHOLD_HIGH,
  THRESHOLD_MEDIUM_HIGH,
  THRESHOLD_MEDIUM,
  THRESHOLD_LOW,
  COLOR_DEEP_RED,
  COLOR_ORANGE,
  COLOR_YELLOW,
  COLOR_LIGHT_GREEN,
  COLOR_DEEP_GREEN,
  COLOR_VIRIDIAN,
  COLOR_UNSPECIFIED,
  generate,
  errorRateToColor,
  getLegendColors,
};