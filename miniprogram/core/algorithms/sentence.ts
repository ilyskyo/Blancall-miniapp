/**
 * 句子切割器：将文章按中英文标点精确切分为句子
 * 对应 Kotlin `com.ilyskyo.blancall.algorithm.SentenceSplitter`
 *
 * 支持：
 * - 中文句末标点：。！？
 * - 英文句末标点：. ! ?
 * - 换行符作为句子分隔（可关闭，用于 PDF 软换行场景）
 * - 避免引号、括号内嵌标点的错误切分
 * - 英文缩写（Mr./Dr./U.S./e.g. 等）与小数（3.14）不被误切
 * - 中文双省略号 …… 不会被切成垃圾句
 * - 保留原句中的换行和空白信息
 *
 * 说明：本文件已与 Kotlin 源逐行核对（含缩写的字母+点 token 提取、右配对符号链、
 * 连续省略号、软换行模式），空白判定复用 `text.ts` 的 `ktIsWhitespace`（对齐
 * Kotlin `Char.isWhitespace()` = isWhitespace ∪ isSpaceChar，不含 U+FEFF/U+0085）。
 */

import { ktIsWhitespace } from './text';

/** 句末标点字符 */
const SENTENCE_END_CHARS = new Set<string>(['。', '！', '？', '.', '!', '?', '…', '~']);

/** 强句末标点（不含英文句点，用于右引号后切分判断，避免缩写/小数干扰） */
const STRONG_SENTENCE_END = new Set<string>(['。', '！', '？', '!', '?', '…']);

/** 右半部分配对符号（这些符号前的句末标点不会导致切分，改由右配对符号处统一判断） */
const RIGHT_PAIRED_CHARS = new Set<string>([
  '"', "'", '」', '』', '】', '）', ')', '》', '>',
]);

/** 常见英文缩写（小写，含内部点）。命中这些 token 内部的句点不切分。 */
const ENGLISH_ABBREVIATIONS = new Set<string>([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc',
  'u.s', 'e.g', 'i.e', 'u.k', 'a.m', 'p.m',
]);

function isWhitespace(ch: string): boolean {
  // Kotlin `Char.isWhitespace()` = Character.isWhitespace ∪ isSpaceChar（不含 U+FEFF/U+0085）
  return ktIsWhitespace(ch);
}

function isDigit(ch: string): boolean {
  return /\p{Nd}/u.test(ch);
}

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

/** 带位置信息的句子（endIndex 为 exclusive 语义） */
export interface SentenceWithPosition {
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * 判断当前位置是否为句子结束位置
 * @param treatNewlineAsSentence 是否把单换行当作切分点
 */
function isSentenceEnd(text: string, index: number, treatNewlineAsSentence = true): boolean {
  const ch = text[index];

  // 换行符处理（连续多个换行只算一次）
  if (ch === '\n') {
    if (!treatNewlineAsSentence) {
      // 软换行模式：单换行不切分（PDF 段落内软换行）
      return false;
    }
    // 逆向查找最后一个非空白、非换行的字符
    let j = index - 1;
    while (j >= 0 && isWhitespace(text[j]) && text[j] !== '\n') j--;
    if (j >= 0) {
      const lastCh = text[j];
      if (lastCh !== '\n' && !SENTENCE_END_CHARS.has(lastCh)) {
        return true;
      }
    }
    return false;
  }

  // 当前字符是右配对符号（右引号/右括号等）
  if (RIGHT_PAIRED_CHARS.has(ch)) {
    let p = index - 1;
    while (p >= 0 && RIGHT_PAIRED_CHARS.has(text[p])) p--;
    if (p >= 0 && STRONG_SENTENCE_END.has(text[p])) {
      const nextIndex = index + 1;
      if (nextIndex < text.length && RIGHT_PAIRED_CHARS.has(text[nextIndex])) {
        return false; // 链路未到末尾，延后切分
      }
      return true;
    }
    return false;
  }

  // 检查是否为句末标点
  if (!SENTENCE_END_CHARS.has(ch)) {
    return false;
  }

  // 英文句点：处理缩写与小数，避免误切
  if (ch === '.') {
    if (isAbbreviationOrDecimal(text, index)) {
      return false;
    }
  }

  // 省略号：连续的 … 只在最后一个之后切分
  if (ch === '…') {
    const nextIndex = index + 1;
    if (nextIndex < text.length && text[nextIndex] === '…') {
      return false; // 后面还有 …，延后切分
    }
    return true;
  }

  // 检查下一个字符是否为右配对符号（引号等）
  const nextIndex = index + 1;
  if (nextIndex < text.length) {
    const nextCh = text[nextIndex];
    if (RIGHT_PAIRED_CHARS.has(nextCh)) {
      return false;
    }
  }

  return true;
}

/**
 * 判断英文句点是否属于缩写或小数，属于则不切分。
 */
function isAbbreviationOrDecimal(text: string, index: number): boolean {
  const prev = index > 0 ? text[index - 1] : '';
  const next = index + 1 < text.length ? text[index + 1] : '';
  if (prev === '' || next === '') return false;

  // 小数：前后都是数字
  if (isDigit(prev) && isDigit(next)) return true;

  // 提取包含此点的连续「字母+点」token
  let token = '';
  let j = index - 1;
  while (j >= 0 && (isLetter(text[j]) || text[j] === '.')) {
    token = text[j] + token;
    j--;
  }
  token += '.';
  let k = index + 1;
  while (k < text.length && (isLetter(text[k]) || text[k] === '.')) {
    token += text[k];
    k++;
  }
  const normalized = token.toLowerCase().replace(/\.+$/, '');
  return ENGLISH_ABBREVIATIONS.has(normalized);
}

/**
 * 将文本切割为句子列表
 * @param text 原文本
 * @param treatNewlineAsSentence 是否将单换行视为句子分隔（默认 true）
 * @return 每个元素为一个完复句子（已去除首尾空白）
 */
function split(text: string, treatNewlineAsSentence = true): string[] {
  const sentences: string[] = [];
  let current = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    current += ch;

    if (isSentenceEnd(text, i, treatNewlineAsSentence)) {
      const sentence = current.trim();
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
      current = '';
    }

    i++;
  }

  const lastSentence = current.trim();
  if (lastSentence.length > 0) {
    sentences.push(lastSentence);
  }

  return sentences;
}

/** 带位置信息切割，返回每句在原文本中的起止位置 */
function splitWithPositions(text: string, treatNewlineAsSentence = true): SentenceWithPosition[] {
  const result: SentenceWithPosition[] = [];
  let sentenceStart = 0;

  // 跳过开头的空白
  while (sentenceStart < text.length && isWhitespace(text[sentenceStart])) {
    sentenceStart++;
  }

  let i = sentenceStart;
  while (i < text.length) {
    if (isSentenceEnd(text, i, treatNewlineAsSentence)) {
      const sentence = text.substring(sentenceStart, i + 1).trim();
      if (sentence.length > 0) {
        // endIndex 统一使用 exclusive 语义（i + 1）
        result.push({ text: sentence, startIndex: sentenceStart, endIndex: i + 1 });
      }
      sentenceStart = i + 1;
      // 跳过后续空白
      while (sentenceStart < text.length && isWhitespace(text[sentenceStart])) {
        sentenceStart++;
      }
      i = sentenceStart - 1;
    }
    i++;
  }

  // 最后一句
  if (sentenceStart < text.length) {
    const sentence = text.substring(sentenceStart).trim();
    if (sentence.length > 0) {
      result.push({ text: sentence, startIndex: sentenceStart, endIndex: text.length });
    }
  }

  return result;
}

export const SentenceSplitter = {
  split,
  splitWithPositions,
};