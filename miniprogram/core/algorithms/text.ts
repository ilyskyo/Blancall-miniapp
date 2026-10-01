// Copyright (c) 2026 ilyskyo
// SPDX-License-Identifier: MIT

/**
 * 文本归一化（忠实移植自 Android/Kotlin 端 `TextNormalizer.kt`）
 *
 * 默写文本归一化：把"排版/书写层面的等价差异"统一，只保留真正的记忆内容差异。
 *
 * 归一化范围（背诵原文场景的宽松等价）：
 * - Unicode NFKC 规范化（兼容字符、全角标点折叠）
 * - 全角 ASCII → 半角
 * - 空白删除（空格/换行/制表符全部移除：中文默写中空白属排版差异，不参与评分）
 * - 常见繁体字 → 简体（小型映射表，仅覆盖常用字，罕见字依赖 NFKC 兜底）
 * - 中文数字 → 阿拉伯数字（宽松等价：如「三」与「3」视为一致）
 *
 * 注意：标点符号**不在**这里去除（逐字复现要求标点准确，由评分器按 0.5 权重扣分）。
 */

// ======================= Kotlin 字符/字符串语义兼容工具 =======================
// Kotlin 的 `Char.isWhitespace()` / `String.trim()` / `String.isBlank()` 语义与 JS 内建的
// `\s` / `trim()` 并不完全一致（JS `\s` 含 U+FEFF、U+00A0 等，Kotlin 不含 U+FEFF）。
// 为保证与 Kotlin 完全一致，此处显式复刻其判定口径，并供 sentence/section 模块复用。

/**
 * Kotlin `Char.isWhitespace()` 等价实现
 * = `Character.isWhitespace(c) || Character.isSpaceChar(c)` 的并集。
 * 注意：不含 U+FEFF(BOM)、U+200B(ZWSP)、U+180E、U+0085。
 */
const KT_WHITESPACE_RE = /[\t\n\v\f\r\x1c-\x1f \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;

export function ktIsWhitespace(ch: string): boolean {
  return KT_WHITESPACE_RE.test(ch);
}

/** Kotlin `String.trimStart()`：去除开头空白（按 Char.isWhitespace 判定） */
export function ktTrimStart(s: string): string {
  let i = 0;
  while (i < s.length && ktIsWhitespace(s.charAt(i))) i++;
  return i === 0 ? s : s.slice(i);
}

/** Kotlin `String.trimEnd()`：去除结尾空白（按 Char.isWhitespace 判定） */
export function ktTrimEnd(s: string): string {
  let e = s.length;
  while (e > 0 && ktIsWhitespace(s.charAt(e - 1))) e--;
  return e === s.length ? s : s.slice(0, e);
}

/** Kotlin `String.trim()`：去除首尾空白（按 Char.isWhitespace 判定） */
export function ktTrim(s: string): string {
  return ktTrimEnd(ktTrimStart(s));
}

/** Kotlin `String.isBlank()`：为空或全部字符为空白（按 Char.isWhitespace 判定） */
export function ktIsBlank(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (!ktIsWhitespace(s.charAt(i))) return false;
  }
  return true;
}

// ============================== TextNormalizer ==============================

/** 常见繁→简映射（覆盖高频字；完整映射需引入 OpenCC 类依赖，暂不纳入） */
const TRADITIONAL_TO_SIMPLIFIED: Map<string, string> = new Map([
  ['們', '们'], ['說', '说'], ['話', '话'], ['這', '这'], ['個', '个'],
  ['會', '会'], ['來', '来'], ['對', '对'], ['時', '时'], ['後', '后'],
  ['點', '点'], ['問', '问'], ['題', '题'], ['學', '学'], ['習', '习'],
  ['體', '体'], ['為', '为'], ['與', '与'], ['發', '发'], ['國', '国'],
  ['開', '开'], ['關', '关'], ['書', '书'], ['讀', '读'], ['寫', '写'],
  ['裡', '里'], ['邊', '边'], ['還', '还'], ['聽', '听'], ['見', '见'],
  ['覺', '觉'], ['愛', '爱'], ['氣', '气'], ['樂', '乐'], ['興', '兴'],
  ['東', '东'], ['車', '车'], ['長', '长'], ['門', '门'],
  ['應', '应'], ['當', '当'], ['從', '从'], ['經', '经'], ['過', '过'],
  ['萬', '万'], ['歲', '岁'], ['馬', '马'], ['鳥', '鸟'], ['魚', '鱼'],
]);

/** 中文数字 → 阿拉伯数字（宽松等价） */
const CHINESE_DIGITS: Map<string, string> = new Map([
  ['零', '0'], ['〇', '0'], ['一', '1'], ['二', '2'], ['兩', '2'], ['两', '2'],
  ['三', '3'], ['四', '4'], ['五', '5'], ['六', '6'], ['七', '7'],
  ['八', '8'], ['九', '9'],
]);

/** 全角 ASCII → 半角（与 AnswerChecker.toHalfWidth 同口径） */
function toHalfWidth(s: string): string {
  let out = '';
  // 逐 code unit 迭代（与 Kotlin 对 Char 的迭代一致）
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const code = s.charCodeAt(i);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else if (c === '\u3000') {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

/** 繁→简 + 中文数字→阿拉伯（单遍 StringBuilder） */
function mapChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const mapped = TRADITIONAL_TO_SIMPLIFIED.get(c);
    if (mapped !== undefined) {
      out += mapped;
    } else {
      const digit = CHINESE_DIGITS.get(c);
      out += digit !== undefined ? digit : c;
    }
  }
  return out;
}

/** 归一化单条文本 */
function normalize(text: string): string {
  let s = text.normalize('NFKC');
  s = toHalfWidth(s);
  s = mapChars(s);
  // 删除全部空白（含换行/制表符）：中文默写中空白是排版差异，不参与评分
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (!ktIsWhitespace(c)) out += c;
  }
  return out;
}

/** 批量归一化（供原文分句一次性缓存，避免提交时重复计算） */
function normalizeList(texts: string[]): string[] {
  return texts.map(normalize);
}

export const TextNormalizer = {
  normalize,
  normalizeList,
};

// =================== 首行缩进相关（TextNormalizer.kt 顶层函数） ===================

/** 判断一行是否已有首行缩进（任意空白开头即视为已缩进，避免重复叠加） */
export function isLineIndented(line: string): boolean {
  return line.length > 0 && ktIsWhitespace(line.charAt(0));
}

/**
 * 幂等地为每段首行补全缩进（两个全角空格）。
 * 以空行划分段落，仅缩进每个段落的起始行；已缩进的段落原样保留，重复调用结果不变。
 * 用于导入粘贴/纯文本时写入存储数据，使阅读与背诵显示一致。
 */
export function applyFirstLineIndent(text: string): string {
  const paragraphs = text.split('\n\n');
  return paragraphs
    .map((para) => {
      const nl = para.indexOf('\n');
      // Kotlin `para.split("\n", limit = 2)`：最多切成两段，第二段保留余下内容
      const first = nl < 0 ? para : para.slice(0, nl);
      const rest = nl < 0 ? null : para.slice(nl + 1);
      if (first === '' || isLineIndented(first)) {
        return para;
      }
      if (rest === null) {
        return '\u3000\u3000' + first;
      }
      return '\u3000\u3000' + first + '\n' + rest;
    })
    .join('\n\n');
}