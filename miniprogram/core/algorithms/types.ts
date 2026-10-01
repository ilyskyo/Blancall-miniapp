/**
 * Blancall 小程序 · 算法共享类型
 *
 * 与 Android 端（Kotlin）数据结构一一对应；改造点：自增 id → uuid（UUIDv7 字符串）。
 * 各算法模块的专属结果类型定义在各自文件内，避免循环依赖。
 */

/** 练习模式（对应 PracticeRecord.mode） */
export type PracticeMode = 'SENTENCE' | 'WORD' | 'REVERSE';

/** 错误类型（对应 MistakeDetail.errorType） */
export type ErrorType = 'TYPO' | 'MISSING' | 'EXTRA' | 'WRONG_ORDER';

/** 挖空策略（对应 BlancallGenerator.Strategy） */
export type ClozeStrategy = 'BALANCED' | 'WEAKNESS_FOCUS' | 'FULL_COVERAGE';

/** 段落范围（对应 PracticeViewModel 的 SectionMode） */
export type SectionMode = 'FULL' | 'WEAKNESS' | 'SELECTED';

/** 错误历史权重（对应 BlancallGenerator.ErrorProfile） */
export interface ErrorProfile {
  /** 句子索引 → 错误率 */
  sentenceErrorRates: Record<number, number>;
  /** 字符 → 错误率 */
  charErrorRates: Record<string, number>;
  /** 词（英文小写）→ 错误率 */
  wordErrorRates: Record<string, number>;
  /** 记忆强度因子：1 = 记忆正常，>1 = 记忆偏弱（由 FSRS 留存率导出） */
  memoryFactor: number;
}

/** 构造空 ErrorProfile（memoryFactor 默认 1） */
export function emptyErrorProfile(memoryFactor = 1): ErrorProfile {
  return {
    sentenceErrorRates: {},
    charErrorRates: {},
    wordErrorRates: {},
    memoryFactor,
  };
}

/** 文章实体（本地/云端同步一致；uuid 为 UUIDv7） */
export interface ArticleEntity {
  uuid: string;
  title: string;
  content: string;
  author: string;
  autoIndent: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 错题明细（对应 MistakeDetail） */
export interface MistakeDetail {
  blankIndex: number;
  correctAnswer: string;
  userAnswer: string;
  errorType: ErrorType;
}

/** 练习记录（对应 PracticeRecord） */
export interface PracticeRecordEntity {
  uuid: string;
  articleUuid: string;
  mode: PracticeMode;
  totalBlanks: number;
  correctCount: number;
  mistakes: MistakeDetail[];
  timestamp: number;
  /** 本次练习耗时（毫秒），0 = 未记录 */
  duration: number;
  /** 默写文本相似度（0..1），0 = 未记录 */
  similarity: number;
  /** FSRS 评级 1..4，0 = 未记录 */
  rating: number;
  /** 弱提示次数 / 强提示次数 */
  weakHints: number;
  strongHints: number;
  /** 判分实际作答句在全文中的字符起始位置（记忆热力图锚点） */
  answeredSentenceStarts: number[];
  /** 判错句在全文切句口径下的索引（跨文练习不落） */
  mistakeSentenceIndices: number[];
}

/** FSRS 卡片状态（对应 FsrsStateStore 的落盘结构） */
export interface FsrsState {
  difficulty: number;
  stability: number;
  /** 到期时间（毫秒时间戳） */
  due: number;
  /** 上次复习时间（毫秒） */
  lastReview: number;
  reviewCount: number;
  lapses: number;
  /** 上次评级 1..4 */
  lastRating: number;
}

/** 句子级 FSRS 键前缀（SentenceSelector.SENTENCE_KEY_PREFIX） */
export const SENTENCE_KEY_PREFIX = 's:';

/** 通用：安全取数值（缺省时回退） */
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 通用：安全取字符串 */
export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}