// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT

/**
 * 段落分层切割器（忠实移植自 Android/Kotlin 端 `SectionSplitter.kt`）
 *
 * 将长文本按自然段落/空行/标题/首行缩进切分为小节
 *
 * 切分规则（优先级从高到低）：
 * 1. 双换行（空行）→ 硬分割边界
 * 2. 首行缩进（全角空格/两个以上半角空格/Tab）→ 段落边界（当无空行时启用）
 * 3. 疑似标题行（短行、无句末标点、可能带编号）→ 作为节标题
 * 4. 单换行 → 软边界（保留在同一节内）
 *
 * 用于 F3 段落分层复习：支持局部集训（仅复习出错段落）和全文连贯模式
 */

import { ktTrim, ktTrimStart, ktTrimEnd, ktIsBlank } from './text';
import { SentenceSplitter } from './sentence';

// 说明：Kotlin/Java 正则的 `\s`/`\S`/`\d` 默认仅覆盖 ASCII（无 UNICODE_CHARACTER_CLASS），
// 而 JS 的 `\s` 含 U+00A0/U+FEFF 等。为保持一致，下面把这些元字符显式展开为 ASCII 集合。
const ASCII_WS_IN_CLASS = ' \\t\\n\\v\\f\\r';
const ASCII_NON_WS = '[^ \\t\\n\\v\\f\\r]';

/** 空行（双换行，中间可有空白）切分正则，提为常量避免重复编译 */
const EMPTY_LINE_REGEX = new RegExp('\\n[' + ASCII_WS_IN_CLASS + ']*\\n', 'g');

/** 句末标点 + 换行 + 缩进 的段落边界正则，提为常量避免重复编译 */
const INDENT_BOUNDARY_REGEX = new RegExp(
  '(?<=[。！？；…」』\u201d])\\n(?=(?:\\u3000\\u3000|\\t| {2,})' + ASCII_NON_WS + ')',
  'g'
);

/** 句末标点 + 单换行（无空行、无缩进时回退使用，支持 \r\n）的段落边界正则 */
const SENTENCE_END_NEWLINE_REGEX = new RegExp('(?<=[。！？…」』\u201d])\\r?\\n', 'g');

/** 标题行带编号模式列表，提为常量避免每次调用重新编译 */
const NUMBERING_PATTERNS: RegExp[] = [
  /^第[一二三四五六七八九十百千]+[章节回篇]/, // 第X章
  new RegExp('^[一二三四五六七八九十]+[、，' + ASCII_WS_IN_CLASS + ']'), // 一、
  /^\d+[.、．]/, // 1. 或 1、
  /^[（(]\d+[)）]/, // (1)
  /^[①②③④⑤⑥⑦⑧⑨⑩]/, // ①
  new RegExp('^第[' + ASCII_WS_IN_CLASS + ']*\\d+[' + ASCII_WS_IN_CLASS + ']*[章节]'), // 第 1 章
  new RegExp('^PART[' + ASCII_WS_IN_CLASS + ']+\\d+', 'i'), // PART 1
  new RegExp('^Chapter[' + ASCII_WS_IN_CLASS + ']+\\d+', 'i'), // Chapter 1
];

/** 标题行判定用句末标点集合 */
const HEADING_END_CHARS: Set<string> = new Set(['。', '！', '？', '.', '!', '?', '…', '~']);

const CJK_RE = /[\u4e00-\u9fff]/;

/** 文本段（对应 Kotlin data class Section） */
export interface Section {
  /** 段序号（从 0 开始） */
  index: number;
  /** 节标题（可能为 null） */
  heading: string | null;
  /** 段落全文（含标题） */
  text: string;
  /** 纯正文（不含标题行） */
  contentOnly: string;
  /** 在原文本中的起始字符位置 */
  startChar: number;
  /** 在原文本中的结束字符位置（exclusive） */
  endChar: number;
  /** 段内句子数 */
  sentenceCount: number;
  /** 该段首句在全文句子索引中的起点（用于错误率归因） */
  startSentenceIndex: number;
}

/** 切分时记录的段落原始偏移区间（已 trim） */
interface ParagraphSpan {
  /** trim 后的段落文本 */
  text: string;
  /** 在原文本中的起始字符位置（trimStart 后） */
  start: number;
  /** 在原文本中的结束字符位置（trimEnd 后，exclusive） */
  end: number;
}

/** 带错误率权重的段落（对应 Kotlin data class RankedSection） */
export interface RankedSection {
  section: Section;
  /** 0-1，该段的错误率 */
  errorRate: number;
}

/** 按全局正则收集所有匹配（等价 Kotlin Regex.findAll） */
function findAll(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m[0].length === 0) re.lastIndex++; // 防御：避免零宽匹配死循环
  }
  return out;
}

/**
 * 将文章按段落切分为小节
 * @param text 文章全文
 * @param minSectionChars 最小段落字符数，过短则合并到上一段
 */
function split(text: string, minSectionChars = 30): Section[] {
  if (ktIsBlank(text)) return [];

  // 第一步：按双换行（空行）粗切（带原始偏移）
  const rawParagraphs = splitByEmptyLines(text);

  // 第二步：若空行切分结果过少，尝试按首行缩进分段（中文排版常见：每段开头缩进两字，段间无空行）
  // 此分支仅当全文无空行（视为单段）时进入，直接对原文本切分以保留正确偏移
  // 再回退：按"句末标点 + 单换行"分段（无空行、无缩进的文本，如论坛/笔记风格）
  let paragraphs: ParagraphSpan[];
  const firstLen = rawParagraphs.length > 0 ? rawParagraphs[0].text.length : 0;
  if (rawParagraphs.length <= 1 && firstLen > 100) {
    const indentSplit = splitByIndentation(text);
    if (indentSplit.length > 1) {
      paragraphs = indentSplit;
    } else {
      const newlineSplit = splitBySentenceEndNewline(text);
      paragraphs = newlineSplit.length > 1 ? newlineSplit : rawParagraphs;
    }
  } else {
    paragraphs = rawParagraphs;
  }

  if (paragraphs.length === 0) {
    const trimmed = ktTrim(text);
    return [
      {
        index: 0,
        heading: null,
        text: trimmed,
        contentOnly: trimmed,
        startChar: 0,
        endChar: text.length,
        sentenceCount: SentenceSplitter.split(trimmed).length,
        startSentenceIndex: 0,
      },
    ];
  }

  // 第三步：识别每个段落标题，构建 Section 列表
  const sections: Section[] = [];
  let sentenceCursor = 0; // 全文句子索引游标（用于 startSentenceIndex 归因）

  for (const span of paragraphs) {
    const paragraph = span.text;

    // 按换行拆分为行
    const lines = paragraph
      .split('\n')
      .map((l) => ktTrim(l))
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // 判断首行是否为标题行
    let heading: string | null;
    let contentLines: string[];
    if (lines.length >= 2 && isHeadingLine(lines[0])) {
      heading = lines[0];
      contentLines = lines.slice(1);
    } else if (lines.length === 1 && isHeadingLine(lines[0])) {
      // 单行标题（无正文），标题即内容
      heading = null;
      contentLines = lines;
    } else {
      heading = null;
      contentLines = lines;
    }

    const contentOnly = contentLines.join('\n');
    const sectionText = heading !== null ? heading + '\n' + contentOnly : contentOnly;

    const sentenceCount = Math.max(SentenceSplitter.split(contentOnly).length, 1);

    const section: Section = {
      index: sections.length,
      heading,
      text: sectionText,
      contentOnly,
      startChar: span.start,
      endChar: span.end,
      sentenceCount,
      startSentenceIndex: sentenceCursor,
    };
    sentenceCursor += sentenceCount;

    sections.push(section);
  }

  // 第四步：合并过短的段落到上一段
  return mergeShortSections(sections, minSectionChars);
}

/** 按空行（双换行）切分文本，并记录每段在原文本中的偏移区间。 */
function splitByEmptyLines(text: string): ParagraphSpan[] {
  const result: ParagraphSpan[] = [];
  let lastEnd = 0;
  for (const match of findAll(EMPTY_LINE_REGEX, text)) {
    addSpanIfNotEmpty(text, lastEnd, match.index, result);
    lastEnd = match.index + match[0].length;
  }
  addSpanIfNotEmpty(text, lastEnd, text.length, result);
  return result;
}

/** 将 text[from, to) 区间 trim 后加入结果（自动修正偏移） */
function addSpanIfNotEmpty(text: string, from: number, to: number, out: ParagraphSpan[]): void {
  if (to <= from) return;
  const span = makeSpan(text, from, to);
  if (span.text.length > 0) out.push(span);
}

/** 由原文本区间构造 ParagraphSpan（trim，并修正偏移到首个/末个非空白字符） */
function makeSpan(text: string, from: number, to: number): ParagraphSpan {
  const raw = text.slice(from, to);
  const trimmed = ktTrim(raw);
  const lead = raw.length - ktTrimStart(raw).length;
  const trail = raw.length - ktTrimEnd(raw).length;
  return { text: trimmed, start: from + lead, end: to - trail };
}

/**
 * 按首行缩进切分段落：
 * 中文排版常见格式——每段开头缩进两个全角空格（  ）或两个以上半角空格，段间无空行。
 * 检测逻辑：若超过 50% 的缩进行前方有句末标点，则确认为段落边界。
 * 返回带原始偏移的段落区间。
 */
function splitByIndentation(text: string): ParagraphSpan[] {
  // 匹配：前面有句末标点（可选右引号）+ 换行 + 缩进（全角空格/Tab/2+半角空格）+ 非空白字符
  const result: ParagraphSpan[] = [];
  let lastEnd = 0;
  for (const match of findAll(INDENT_BOUNDARY_REGEX, text)) {
    // 边界 \n 归属下一段（trim 时去除）
    addSpanIfNotEmpty(text, lastEnd, match.index, result);
    lastEnd = match.index;
  }
  addSpanIfNotEmpty(text, lastEnd, text.length, result);
  if (result.length > 1) return result;

  // 回退：不要求前方有标点，仅按缩进行切分（但需多数行有缩进才生效）
  return splitByIndentLines(text);
}

/**
 * 按"句末标点 + 单换行"切分段落（无空行、无缩进的文本回退方案）。
 * 仅当空行切分和缩进切分都失败时启用。
 * 换行前是 。！？… 等强句末标点时，视为段落边界。
 */
function splitBySentenceEndNewline(text: string): ParagraphSpan[] {
  const result: ParagraphSpan[] = [];
  let lastEnd = 0;
  for (const match of findAll(SENTENCE_END_NEWLINE_REGEX, text)) {
    // 换行归属下一段（trim 时去除），保留 \r 让 makeSpan 的 trim 清理
    addSpanIfNotEmpty(text, lastEnd, match.index, result);
    lastEnd = match.index;
  }
  addSpanIfNotEmpty(text, lastEnd, text.length, result);
  return result;
}

/** 回退：按缩进行切分（行级），返回带偏移的段落区间 */
function splitByIndentLines(text: string): ParagraphSpan[] {
  // 先把每行与其在原文本中的起始偏移配对
  const lineSpans: Array<[number, string]> = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    lineSpans.push([pos, line]);
    pos += line.length + 1; // +1 为 \n（末行无 \n 也不影响后续使用）
  }

  const indentLineCount = lineSpans.filter(
    ([, l]) => l.startsWith('\u3000\u3000') || l.startsWith('\t') || l.startsWith('  ')
  ).length;
  if (indentLineCount < 2) {
    // 整体作为一段
    const span = makeSpan(text, 0, text.length);
    return span.text.length === 0 ? [] : [span];
  }

  const result: ParagraphSpan[] = [];
  let segStart = 0;
  let segEnd = 0;
  let hasContent = false;

  for (const [lineStart, line] of lineSpans) {
    const isIndented =
      line.startsWith('\u3000\u3000') ||
      line.startsWith('\t') ||
      (line.length >= 3 && line.charAt(0) === ' ' && line.charAt(1) === ' ' && line.charAt(2) !== ' ');
    if (isIndented && hasContent) {
      result.push(makeSpan(text, segStart, segEnd));
      hasContent = false;
    }
    if (!hasContent) segStart = lineStart;
    segEnd = lineStart + line.length;
    if (!ktIsBlank(line)) hasContent = true;
  }
  if (hasContent) result.push(makeSpan(text, segStart, segEnd));

  return result.filter((s) => s.text.length > 0);
}

/**
 * 判断一行是否为标题行：
 * - 不以句末标点结尾（。！？.!?）
 * - 较短（一般 ≤ 30 字）
 * - 或者带编号（一、1. (1) 第X章 等）
 */
function isHeadingLine(line: string): boolean {
  if (line.length > 40) return false;
  const trimmed = ktTrim(line);

  // 带编号模式（使用预编译常量列表）
  if (NUMBERING_PATTERNS.some((p) => p.test(trimmed))) return true;

  // 不以句末标点结尾
  if (trimmed.length > 0 && HEADING_END_CHARS.has(trimmed.charAt(trimmed.length - 1))) return false;

  // 较短且包含中文
  return CJK_RE.test(trimmed) && trimmed.length <= 25;
}

/**
 * 合并过短的段落（字符数不足 minChars 则合并到前一段）
 */
function mergeShortSections(sections: Section[], minChars: number): Section[] {
  if (sections.length <= 1) return sections;

  const result: Section[] = [];
  let accumulator: Section | null = null;

  for (const section of sections) {
    if (accumulator === null) {
      accumulator = section;
    } else if (section.contentOnly.length < minChars && accumulator.heading === null) {
      // 当前段太短，合并到前一段（保留首段的 startSentenceIndex）
      accumulator = {
        index: accumulator.index,
        heading: accumulator.heading,
        text: accumulator.text + '\n' + section.text,
        contentOnly: accumulator.contentOnly + '\n' + section.contentOnly,
        startChar: accumulator.startChar,
        endChar: section.endChar,
        sentenceCount: accumulator.sentenceCount + section.sentenceCount,
        startSentenceIndex: accumulator.startSentenceIndex,
      };
    } else {
      result.push(accumulator);
      accumulator = section;
    }
  }

  if (accumulator !== null) result.push(accumulator);

  // 重新分配序号
  return result.map((s, idx) => ({ ...s, index: idx }));
}

/**
 * 获取含错误率权重的段落列表（用于分段复习模式）
 * 返回段落并按 errorRate 倒序排列（薄弱优先）
 */
function rankByErrorRate(
  sections: Section[],
  sentenceErrorRates: Record<number, number | undefined>
): RankedSection[] {
  return sections
    .map((section) => {
      // 用该段首句在全文的索引作为起点（而非段序号），保证与 sentenceErrorRates 的 key 对齐
      const startIdx = section.startSentenceIndex;
      const sentences = SentenceSplitter.split(section.contentOnly);
      let totalRate = 0;
      let matchCount = 0;
      for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
        const globalSentIdx = startIdx + sIdx;
        const rate = sentenceErrorRates[globalSentIdx];
        if (rate !== undefined) {
          totalRate += rate;
          matchCount++;
        }
      }
      const avgRate = matchCount > 0 ? totalRate / matchCount : 0;
      return { section, errorRate: avgRate } as RankedSection;
    })
    .sort((a, b) => b.errorRate - a.errorRate);
}

export const SectionSplitter = {
  split,
  rankByErrorRate,
};