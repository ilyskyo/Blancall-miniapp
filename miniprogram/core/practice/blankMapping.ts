/**
 * 空位映射与记忆热力图锚点（纯函数，无 wx 依赖，可单元测试）
 *
 * 背景（曾出现的真实缺陷）：
 * - 字词挖空的 `WordBlankInfo` 只有句内偏移、没有句子索引，若直接写死
 *   `sentenceIndex = 0`，会导致句级 FSRS、薄弱集训、热力图归因全部落到第 0 句；
 * - 字词挖空的句子文本已插入 `___`，若直接拿去与全文切句比对必然失败，
 *   导致 `answeredSentenceStarts` 恒为空、热力图丢失"答对/未作答"区分。
 *
 * 本模块集中处理这两件事，session.ts 只负责编排，便于测试与复用。
 */

import {
  SentenceClozeResult,
  WordClozeResult,
  WordClozeSentence,
} from '../algorithms/cloze';
import { SentenceSplitter } from '../algorithms/sentence';

/** 运行时空位（对应 Kotlin 侧按 blank 索引组织的作答单元） */
export interface BlankRuntime {
  /** 全局空序号（从 0 开始，与 record.mistakes.blankIndex 对齐） */
  index: number;
  /** 正确答案 */
  answer: string;
  /** 所属句子索引（句子/字词模式） */
  sentenceIndex: number;
  /** 句内起始（供 UI 定位） */
  startInSentence: number;
  endInSentence: number;
}

/** 句子挖空 → 运行时空位（SentenceBlankInfo 已自带 sentenceIndex） */
export function mapSentenceBlanks(result: SentenceClozeResult): BlankRuntime[] {
  return result.blanks.map((b) => ({
    index: b.index,
    answer: b.originalText,
    sentenceIndex: b.sentenceIndex,
    startInSentence: b.startInSentence,
    endInSentence: b.endInSentence,
  }));
}

/**
 * 由 `WordClozeSentence.blanks`（该句包含的全局空序号）反推
 * blankIndex → sentenceIndex 映射
 */
export function buildWordBlankSentenceMap(sentences: WordClozeSentence[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx];
    for (const blankIndex of (sentence && sentence.blanks) || []) {
      if (!map.has(blankIndex)) map.set(blankIndex, sIdx);
    }
  }
  return map;
}

/** 字词挖空 → 运行时空位（补齐 sentenceIndex） */
export function mapWordBlanks(result: WordClozeResult): BlankRuntime[] {
  const blankToSentence = buildWordBlankSentenceMap(result.sentences || []);
  return result.blanks.map((b) => ({
    index: b.index,
    answer: b.originalChar,
    sentenceIndex: blankToSentence.get(b.index) ?? 0,
    startInSentence: b.position,
    endInSentence: b.position + b.originalChar.length,
  }));
}

/**
 * 由「已挖空文本 + 该句包含的空序号」还原原文（按顺序把 `___` 回填为答案）
 * 用于字词模式：只有还原后才能与全文切句做文本匹配，进而定位字符锚点。
 */
export function restoreWordSentence(
  blanked: string,
  blankIndices: number[],
  blanks: BlankRuntime[]
): string {
  let out = blanked;
  for (const blankIndex of blankIndices || []) {
    const blank = blanks.find((b) => b.index === blankIndex);
    if (!blank) continue;
    out = out.replace('___', blank.answer);
  }
  return out;
}

/** 字词模式的全部句原文（顺序与 result.sentences 一致） */
export function wordSentenceOriginals(
  sentences: WordClozeSentence[],
  blanks: BlankRuntime[]
): string[] {
  return (sentences || []).map((s) => restoreWordSentence(s.text, s.blanks || [], blanks));
}

/**
 * 计算「实际作答句」在全文中的字符起始位置（记忆热力图锚点）
 *
 * 与 Android 端 `buildSentenceAnchors` 的口径一致：锚点用字符位置而非句子索引，
 * 才能跨「全文切句」与「段落子集切句」两种口径稳定对齐。
 *
 * @param fullContent        文章全文（未裁剪）
 * @param sentenceOriginals  会话句的原文（字词模式已回填 ___）
 * @param touchedSentenceIdx 本次实际作答（非空）的会话句索引集合
 */
export function computeAnsweredStarts(
  fullContent: string,
  sentenceOriginals: string[],
  touchedSentenceIdx: Iterable<number>
): number[] {
  const fullSentences = SentenceSplitter.splitWithPositions(fullContent);
  const starts: number[] = [];
  for (const sIdx of touchedSentenceIdx) {
    const original = sentenceOriginals[sIdx];
    if (!original) continue;
    // 优先按文本精确匹配（会话为段落子集时也能对齐到全文坐标）
    const hit = fullSentences.find((it) => it.text === original);
    if (hit) {
      starts.push(hit.startIndex);
      continue;
    }
    // 回退：同序索引对齐（同一分句器，句序一致）
    const byIndex = fullSentences[sIdx];
    if (byIndex) starts.push(byIndex.startIndex);
  }
  return starts;
}

// ============================== AI 未覆盖区间的本地补齐 ==============================

/**
 * AI 只看得到全文前 `aiLimit` 个字符（与 `LIMITS.aiClozeMaxChars` 一致），
 * 返回「AI 看不到」的句索引（句子起点 ≥ aiLimit）。
 *
 * 与 Kotlin 端行为一致：AI 覆盖区间之外的句子由本地算法补齐挖空，
 * 避免长文只在前半部分挖空（历史缺陷）。
 */
export function unseenSentenceIndices(content: string, aiLimit: number): number[] {
  const items = SentenceSplitter.splitWithPositions(content);
  const out: number[] = [];
  items.forEach((it, idx) => {
    if (it.startIndex >= aiLimit) out.push(idx);
  });
  return out;
}

/** 由本地算法已生成的空位（BlankRuntime）反推「句内区间的半开范围」，可指定只取某些句 */
export function rangesFromLocalBlanks(
  blanks: BlankRuntime[],
  accept: (sentenceIndex: number) => boolean
): Map<number, Array<{ first: number; last: number }>> {
  const ranges = new Map<number, Array<{ first: number; last: number }>>();
  for (const b of blanks) {
    if (!accept(b.sentenceIndex)) continue;
    const end = Math.max(b.endInSentence, b.startInSentence + 1);
    const arr = ranges.get(b.sentenceIndex) || [];
    arr.push({ first: b.startInSentence, last: end - 1 });
    ranges.set(b.sentenceIndex, arr);
  }
  return ranges;
}

/** 合并两组「句内区间」（用于 AI 区间 ∪ 本地补齐区间） */
export function mergeRanges(
  base: Map<number, Array<{ first: number; last: number }>>,
  extra: Map<number, Array<{ first: number; last: number }>>
): Map<number, Array<{ first: number; last: number }>> {
  const merged = new Map<number, Array<{ first: number; last: number }>>();
  base.forEach((list, sIdx) => merged.set(sIdx, list.slice()));
  extra.forEach((list, sIdx) => {
    const cur = merged.get(sIdx) || [];
    merged.set(sIdx, cur.concat(list));
  });
  return merged;
}