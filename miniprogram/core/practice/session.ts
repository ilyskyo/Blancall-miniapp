/**
 * 练习会话引擎
 *
 * 职责：把「算法（分句/挖空/判定/评分/FSRS）」与「存储（进度/记录/统计）」串起来，
 * 页面只负责渲染与输入采集，所有规则口径集中在这里，保证与 Android 端功能等价。
 */

import { SentenceSplitter } from '../algorithms/sentence';
import { SectionSplitter, Section } from '../algorithms/section';
import {
  BlancallGenerator,
  SentenceClozeResult,
  WordClozeResult,
  DictationResult,
  ShuffledClause,
} from '../algorithms/cloze';
import { AnswerChecker, CheckDetail } from '../algorithms/answer';
import { DictationScorer } from '../algorithms/dictation';
import { FsrsEngine, Rating, CardState } from '../algorithms/fsrs';
import { DifficultyCalculator } from '../algorithms/difficulty';
import {
  ClozeStrategy,
  ErrorProfile,
  emptyErrorProfile,
  MistakeDetail,
  PracticeMode,
  PracticeRecordEntity,
  SectionMode,
} from '../algorithms/types';
import {
  appendRecord,
  articleStore,
  customClozeOfArticle,
  getFsrs,
  recordsOfArticle,
  saveProgress,
  sentenceFsrsKey,
  setFsrs,
  getProgress,
  inProgressStates,
  PracticeStateEntity,
  clearProgress,
} from '../storage/entities';
import { scheduleSync } from '../net/sync';
import { track } from '../telemetry';

export interface SessionOptions {
  articleUuid: string;
  mode: PracticeMode;
  strategy?: ClozeStrategy;
  /** 指定空数（0 = 自动） */
  count?: number;
  sectionMode?: SectionMode;
  /** 自选段落索引（sectionMode = SELECTED） */
  selectedSections?: number[];
  /** 自定义挖空配置 uuid（可选，覆盖生成的挖空） */
  configUuid?: string;
  /** 覆盖内容（跨文复习时由调用方拼接） */
  contentOverride?: string;
  /** 是否古文模式（字词挖空虚词降权） */
  classicalMode?: boolean;
  /** 恢复历史进度时使用已保存的挖空 JSON */
  restoreClozeJson?: string;
}

export interface BlankRuntime {
  /** 全局空序号（从 0 开始，与 record.mistakes.blankIndex 对齐） */
  index: number;
  /** 正确答案 */
  answer: string;
  /** 所属句子索引（句子/字词模式） */
  sentenceIndex: number;
  /** 句内起始（字词/句子模式，供 UI 定位） */
  startInSentence: number;
  endInSentence: number;
}

export interface PracticeSession {
  articleUuid: string;
  mode: PracticeMode;
  strategy: ClozeStrategy;
  sectionMode: SectionMode;
  classicalMode: boolean;
  /** 参与练习的文本（段落范围裁剪后） */
  content: string;
  /** 句子/分句列表（判分与跳转依据） */
  sentences: string[];
  /**
   * 每个会话句的**原文**（未挖空），用于记忆热力图的字符锚点匹配：
   * - SENTENCE：即 sentences 本身
   * - WORD：由已挖空文本按答案回填 ___ 还原
   * - REVERSE：空数组（不参与锚点）
   */
  sentenceOriginals: string[];
  /** 展示文本（含 ___ 占位；句子/字词模式） */
  displayText: string;
  blanks: BlankRuntime[];
  /** 反向默写数据 */
  dictation: { clauses: string[]; shuffled: ShuffledClause[] } | null;
  maxBlanks: number;
  suggestedBlanks: number;
  configUuid: string;
  startedAt: number;
  /** 逐空作答 */
  answers: Record<number, string>;
  /** 反向默写整段作答 */
  dictationInput: string;
  /** 已生成的挖空 JSON（用于断点恢复） */
  clozeJson: string;
  /** 本次练习的弱/强提示次数（计入记录） */
  weakHints: number;
  strongHints: number;
  /** 当前聚焦空（提示计时使用） */
  focusBlankIndex: number | null;
  /** 跨文复习：多篇混编（不落句级 FSRS、不落断点，与 Android 端一致） */
  crossMode: boolean;
}

export interface Judgment {
  correctCount: number;
  totalBlanks: number;
  similarity: number;
  rating: number;
  mistakes: MistakeDetail[];
  /** 逐空判定结果（key = 空序号） */
  perBlank: Record<number, CheckDetail>;
  /** 反向默写的分句级结果 */
  dictationDetail?: ReturnType<typeof AnswerChecker.checkDictation>;
  accuracy: number;
  durationMs: number;
}

// ============================== 错误画像 ==============================

/** 从历史记录构造挖空权重（错误率 + 记忆强度因子） */
export function buildErrorProfile(articleUuid: string, now: number = Date.now()): ErrorProfile {
  const records = recordsOfArticle(articleUuid);
  const profile = emptyErrorProfile();
  if (records.length === 0) return profile;

  const article = articleStore.find(articleUuid);
  const sentenceCount = article ? SentenceSplitter.split(article.content).length : 0;

  const sentenceHits = new Map<number, number>();
  const sentenceTotal = new Map<number, number>();
  const charHits = new Map<string, number>();
  const charTotal = new Map<string, number>();
  const wordHits = new Map<string, number>();
  const wordTotal = new Map<string, number>();

  for (const rec of records) {
    // 句级：未作答的句子不计入
    if (sentenceCount > 0 && rec.answeredSentenceStarts.length > 0) {
      // 记录仅提供字符锚点，这里按"本次判错的句索引"统计错误、其余按作答数记总数
      for (const idx of rec.mistakeSentenceIndices) {
        sentenceHits.set(idx, (sentenceHits.get(idx) || 0) + 1);
      }
      for (const idx of rec.mistakeSentenceIndices) {
        sentenceTotal.set(idx, (sentenceTotal.get(idx) || 0) + 1);
      }
    }
    for (const m of rec.mistakes) {
      const correct = m.correctAnswer || '';
      for (const ch of correct) {
        charTotal.set(ch, (charTotal.get(ch) || 0) + 1);
      }
      if (m.errorType !== 'WRONG_ORDER') {
        for (const ch of correct) {
          if (!m.userAnswer.includes(ch)) charHits.set(ch, (charHits.get(ch) || 0) + 1);
        }
      }
      const words = correct.toLowerCase().match(/[a-z]+/g) || [];
      for (const w of words) {
        wordTotal.set(w, (wordTotal.get(w) || 0) + 1);
        if (!m.userAnswer.toLowerCase().includes(w)) wordHits.set(w, (wordHits.get(w) || 0) + 1);
      }
    }
  }

  sentenceTotal.forEach((total, idx) => {
    if (total > 0) profile.sentenceErrorRates[idx] = (sentenceHits.get(idx) || 0) / total;
  });
  charTotal.forEach((total, ch) => {
    if (total > 0) profile.charErrorRates[ch] = (charHits.get(ch) || 0) / total;
  });
  wordTotal.forEach((total, w) => {
    if (total > 0) profile.wordErrorRates[w] = (wordHits.get(w) || 0) / total;
  });

  // 记忆强度因子：文章级 FSRS 留存率
  const state = getFsrs(articleUuid);
  if (state) {
    const retention = FsrsEngine.retentionRate(state as never, now);
    let factor = 1;
    if (retention < 0.5) factor = 1.45;
    else if (retention < 0.7) factor = 1.25;
    else if (retention < 0.85) factor = 1.1;
    if ((state.lapses || 0) >= 2) factor += 0.1;
    profile.memoryFactor = Math.min(1.6, Math.max(1, factor));
  }
  return profile;
}

// ============================== 段落范围 ==============================

function resolveContent(articleUuid: string, options: SessionOptions): { content: string; sections: Section[] } {
  const article = articleStore.find(articleUuid);
  if (!article) return { content: options.contentOverride || '', sections: [] };
  const full = options.contentOverride || article.content;
  const sections = SectionSplitter.split(full);
  const mode = options.sectionMode || 'FULL';
  if (mode === 'FULL' || sections.length === 0) return { content: full, sections };

  if (mode === 'SELECTED') {
    const picked = (options.selectedSections || []).filter((i) => i >= 0 && i < sections.length);
    if (picked.length === 0) return { content: full, sections };
    const content = picked
      .sort((a, b) => a - b)
      .map((i) => sections[i].contentOnly)
      .join('\n\n');
    return { content, sections };
  }

  // WEAKNESS：按句级错误率排序，取有错误史的段落；无历史则回退全文
  const profile = buildErrorProfile(articleUuid);
  const ranked = SectionSplitter.rankByErrorRate(sections, profile.sentenceErrorRates);
  const weak = ranked.filter((r) => r.errorRate > 0).sort((a, b) => b.errorRate - a.errorRate);
  if (weak.length === 0) return { content: full, sections };
  const content = weak
    .map((r) => r.section)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.contentOnly)
    .join('\n\n');
  return { content, sections };
}

// ============================== 会话构建 ==============================

// 空位映射与锚点计算集中在纯函数模块（可单测；修复过字词模式句级归因与锚点缺陷）
import {
  computeAnsweredStarts,
  mapSentenceBlanks,
  mapWordBlanks,
  mergeRanges,
  rangesFromLocalBlanks,
  unseenSentenceIndices,
  wordSentenceOriginals,
} from './blankMapping';
import { LIMITS } from '../config';

/** 句子挖空 → 运行时空位（SentenceBlankInfo 自带句索引） */
function toBlankRuntimeFromSentence(result: SentenceClozeResult): BlankRuntime[] {
  return mapSentenceBlanks(result);
}

/** 字词挖空 → 运行时空位（由 sentences[].blanks 反推句索引） */
function toBlankRuntimeFromWord(result: WordClozeResult): BlankRuntime[] {
  return mapWordBlanks(result);
}

/** 开始（或恢复）一次练习 */
export function startSession(options: SessionOptions): { session: PracticeSession; warning?: string } {
  const { content, sections } = resolveContent(options.articleUuid, options);
  const mode = options.mode;
  const strategy = options.strategy || 'BALANCED';
  const configUuid = options.configUuid || '';
  const profile = buildErrorProfile(options.articleUuid);
  const session: PracticeSession = {
    articleUuid: options.articleUuid,
    mode,
    strategy,
    sectionMode: options.sectionMode || 'FULL',
    classicalMode: !!options.classicalMode,
    content,
    sentences: [],
    sentenceOriginals: [],
    displayText: '',
    blanks: [],
    dictation: null,
    maxBlanks: 0,
    suggestedBlanks: 0,
    configUuid,
    startedAt: Date.now(),
    answers: {},
    dictationInput: '',
    clozeJson: options.restoreClozeJson || '',
    weakHints: 0,
    strongHints: 0,
    focusBlankIndex: null,
    crossMode: !!options.contentOverride,
  };

  let warning: string | undefined;

  // 自定义挖空配置优先
  const customConfig = configUuid
    ? customClozeOfArticle(options.articleUuid).find((c) => c.uuid === configUuid) || null
    : null;

  if (customConfig) {
    if (customConfig.mode === 'REVERSE') {
      const sentenceIdx = new Set(customConfig.levels || []);
      const result = BlancallGenerator.buildCustomDictation(content, sentenceIdx);
      applyDictation(session, result);
      session.clozeJson = BlancallGenerator.dictationToJson(result);
    } else {
      const ranges = new Map<number, Array<{ first: number; last: number }>>();
      for (const b of customConfig.blanks || []) {
        const list = ranges.get(b.s) || [];
        list.push({ first: b.a, last: Math.max(b.a, b.b - 1) });
        ranges.set(b.s, list);
      }
      const result = BlancallGenerator.buildCustomSentenceCloze(content, ranges);
      applySentence(session, result);
      session.clozeJson = BlancallGenerator.sentenceClozeToJson(result);
    }
  } else if (mode === 'REVERSE') {
    const result = BlancallGenerator.generateDictation(content);
    if (result.clauses.length === 0) warning = '内容过短，无法生成反向默写';
    applyDictation(session, result);
    session.clozeJson = BlancallGenerator.dictationToJson(result);
  } else if (mode === 'WORD') {
    const result = BlancallGenerator.generateWordCloze(
      content,
      options.count || 0,
      profile,
      strategy,
      options.classicalMode
    );
    applyWord(session, result);
    session.clozeJson = BlancallGenerator.wordClozeToJson(result);
  } else {
    const result = BlancallGenerator.generateSentenceCloze(content, options.count || 0, profile, strategy);
    applySentence(session, result);
    session.clozeJson = BlancallGenerator.sentenceClozeToJson(result);
  }

  if (sections.length === 0 && !content.trim()) warning = '文章内容为空';
  return { session, warning };
}

function applySentence(session: PracticeSession, result: SentenceClozeResult): void {
  session.sentences = result.sentences;
  // 句子模式的 sentences 即原句（未挖空），可直接作为锚点匹配源
  session.sentenceOriginals = result.sentences.slice();
  session.displayText = result.displayText;
  session.blanks = toBlankRuntimeFromSentence(result);
  session.maxBlanks = session.blanks.length;
  session.suggestedBlanks = session.blanks.length;
}

function applyWord(session: PracticeSession, result: WordClozeResult): void {
  session.blanks = toBlankRuntimeFromWord(result);
  session.sentences = result.sentences.map((s) => s.text);
  // 字词模式 text 已挖空：按答案回填 ___ 还原原文，供记忆热力图的字符锚点匹配
  session.sentenceOriginals = wordSentenceOriginals(result.sentences || [], session.blanks);
  session.displayText = result.displayText;
  session.maxBlanks = result.maxBlanks;
  session.suggestedBlanks = result.suggestedBlanks;
}

function applyDictation(session: PracticeSession, result: DictationResult): void {
  session.sentences = result.clauses;
  session.sentenceOriginals = [];
  session.dictation = { clauses: result.clauses, shuffled: result.shuffledClauses };
  session.blanks = [];
  session.displayText = result.clauses.join('');
}

// ============================== 作答与判定 ==============================

export function setAnswer(session: PracticeSession, blankIndex: number, value: string): void {
  session.answers[blankIndex] = value;
}

export function setDictationInput(session: PracticeSession, value: string): void {
  session.dictationInput = value;
}

/** 判定：句子/字词模式逐空；反向默写整段双通道评分 */
export function judgeSession(session: PracticeSession, now: number = Date.now()): Judgment {
  const startedAt = session.startedAt;
  if (session.mode === 'REVERSE') {
    const clauses = session.dictation ? session.dictation.clauses : session.sentences;
    const input = session.dictationInput;
    const detail = AnswerChecker.checkDictation(clauses, input);
    const similarity = DictationScorer.score(clauses.join(''), input);
    const total = clauses.length || 1;
    const correctCount = detail.sentences.filter((s) => s.result === 'CORRECT').length;
    const accuracy = correctCount / total;
    const useSimilarity = true;
    const rating = useSimilarity ? FsrsEngine.gradeFromSimilarity(similarity) : FsrsEngine.ratingFromAccuracy(accuracy);
    const mistakes: MistakeDetail[] = detail.sentences
      .map((s, i) => ({ s, i }))
      .filter((it) => it.s.result !== 'CORRECT')
      .map((it) => ({
        blankIndex: it.i,
        correctAnswer: it.s.matchedOriginal || clauses[it.i] || '',
        userAnswer: it.s.userText || '',
        errorType: 'TYPO' as const,
      }));
    return {
      correctCount,
      totalBlanks: clauses.length,
      similarity,
      rating: rating as number,
      mistakes,
      perBlank: {},
      dictationDetail: detail,
      accuracy,
      durationMs: now - startedAt,
    };
  }

  const perBlank: Record<number, CheckDetail> = {};
  const mistakes: MistakeDetail[] = [];
  let correctCount = 0;
  let similaritySum = 0;
  for (const blank of session.blanks) {
    const user = (session.answers[blank.index] || '').trim();
    const detail = AnswerChecker.check(blank.answer, user);
    perBlank[blank.index] = detail;
    similaritySum += detail.similarity;
    if (detail.result === 'CORRECT') correctCount++;
    else {
      mistakes.push({
        blankIndex: blank.index,
        correctAnswer: blank.answer,
        userAnswer: user,
        errorType: detail.result === 'INCORRECT' ? 'TYPO' : (detail.result as MistakeDetail['errorType']),
      });
    }
  }
  const total = session.blanks.length || 1;
  const accuracy = correctCount / total;
  const similarity = session.blanks.length > 0 ? similaritySum / session.blanks.length : 0;
  const rating = FsrsEngine.gradeFromSimilarity(similarity);
  return {
    correctCount,
    totalBlanks: session.blanks.length,
    similarity,
    rating: rating as number,
    mistakes,
    perBlank,
    accuracy,
    durationMs: now - startedAt,
  };
}

// ============================== 提示系统 ==============================

/**
 * 下一个应提示的字（弱提示：淡显；强提示：自动填入）
 * - 句子/字词模式：按当前空的答案与已输入内容推进
 * - 反向默写：按原文顺序推进
 * 返回 null 表示无需提示（已填完或已到达末尾）
 */
export function nextHint(session: PracticeSession, blankIndex: number | null): { blankIndex: number | null; char: string } | null {
  if (session.mode === 'REVERSE') {
    const full = (session.dictation ? session.dictation.clauses.join('') : session.sentences.join(''));
    const input = session.dictationInput;
    if (input.length >= full.length) return null;
    return { blankIndex: null, char: full.charAt(input.length) };
  }
  const target = pickHintBlank(session, blankIndex);
  if (target === null) return null;
  const blank = session.blanks.find((b) => b.index === target);
  if (!blank) return null;
  const typed = session.answers[target] || '';
  if (typed.length >= blank.answer.length) return null;
  return { blankIndex: target, char: blank.answer.charAt(typed.length) };
}

/** 选择要提示的空：优先当前聚焦空；否则第一个未填完的空 */
export function pickHintBlank(session: PracticeSession, blankIndex: number | null): number | null {
  if (blankIndex !== null) {
    const b = session.blanks.find((it) => it.index === blankIndex);
    if (b && (session.answers[b.index] || '').length < b.answer.length) return b.index;
    return null;
  }
  for (const b of session.blanks) {
    if ((session.answers[b.index] || '').length < b.answer.length) return b.index;
  }
  return null;
}

/** 强提示：把下一个字写入答案（由页面调用后 setData 刷新） */
export function applyStrongHint(session: PracticeSession, blankIndex: number | null): { blankIndex: number | null; char: string } | null {
  const hint = nextHint(session, blankIndex);
  if (!hint) return null;
  if (hint.blankIndex === null) {
    session.dictationInput = `${session.dictationInput}${hint.char}`;
  } else {
    session.answers[hint.blankIndex] = `${session.answers[hint.blankIndex] || ''}${hint.char}`;
  }
  return hint;
}

// ============================== 进度持久化（断点续练） ==============================

/** 仅在「部分提交」时落盘（与 Android 端一致：完整提交后清除） */
export function persistProgress(session: PracticeSession, judgment?: Judgment): void {
  const answeredCount = session.mode === 'REVERSE' ? (session.dictationInput ? 1 : 0) : Object.keys(session.answers).filter((k) => (session.answers[Number(k)] || '').trim()).length;
  saveProgress({
    articleUuid: session.articleUuid,
    mode: session.mode,
    status: 'IN_PROGRESS',
    totalBlanks: session.mode === 'REVERSE' ? session.sentences.length : session.blanks.length,
    answeredCount,
    answers: session.answers,
    dictationInput: session.dictationInput,
    clozeJson: session.clozeJson,
    configUuid: session.configUuid,
    lastPracticeTime: Date.now(),
  });
  void judgment;
  scheduleSync();
}

export function discardProgress(articleUuid: string): void {
  clearProgress(articleUuid);
  scheduleSync();
}

/** 从断点恢复会话（复用原挖空，避免重新生成导致内容变化） */
export function restoreSession(articleUuid: string, mode?: PracticeMode): PracticeSession | null {
  const state = getProgress(articleUuid);
  if (!state || state.status !== 'IN_PROGRESS') return null;
  const options: SessionOptions = {
    articleUuid,
    mode: (mode || state.mode) as PracticeMode,
    configUuid: state.configUuid || '',
  };
  const { session } = startSession(options);
  // 复用原挖空：以保存的 clozeJson 为准
  if (state.clozeJson) {
    try {
      if (session.mode === 'REVERSE') {
        const parsed = BlancallGenerator.dictationFromJson(state.clozeJson);
        if (parsed) applyDictation(session, parsed);
      } else if (session.mode === 'WORD') {
        const parsed = BlancallGenerator.wordClozeFromJson(state.clozeJson);
        if (parsed) applyWord(session, parsed);
      } else {
        const parsed = BlancallGenerator.sentenceClozeFromJson(state.clozeJson);
        if (parsed) applySentence(session, parsed);
      }
      session.clozeJson = state.clozeJson;
    } catch {
      /* 解析失败则使用重新生成的挖空 */
    }
  }
  session.answers = { ...state.answers };
  session.dictationInput = state.dictationInput || '';
  session.startedAt = state.lastPracticeTime || Date.now();
  // 配置已被删除时提示降级
  if (state.configUuid && !customClozeOfArticle(articleUuid).some((c) => c.uuid === state.configUuid)) {
    session.configUuid = '';
  }
  return session;
}

/** 首页「继续练习」：扫描进行中的练习 */
export function listInProgress(): Array<{ state: PracticeStateEntity; articleTitle: string }> {
  const out: Array<{ state: PracticeStateEntity; articleTitle: string }> = [];
  for (const state of inProgressStates()) {
    const article = articleStore.find(state.articleUuid);
    out.push({ state, articleTitle: article ? article.title : '(已删除)' });
  }
  return out;
}

// ============================== 提交落库 ==============================

/** 完成一次练习：写记录 + 更新 FSRS（文章级与句子级） */
export function commitSession(session: PracticeSession, judgment: Judgment): PracticeRecordEntity {
  const record = appendRecord({
    articleUuid: session.articleUuid,
    mode: session.mode,
    totalBlanks: judgment.totalBlanks,
    correctCount: judgment.correctCount,
    mistakes: judgment.mistakes,
    timestamp: Date.now(),
    duration: judgment.durationMs,
    similarity: judgment.similarity,
    rating: judgment.rating,
    weakHints: session.weakHints || 0,
    strongHints: session.strongHints || 0,
    answeredSentenceStarts: collectAnsweredStarts(session),
    mistakeSentenceIndices: session.mode === 'REVERSE' ? judgment.mistakes.map((m) => m.blankIndex) : judgment.mistakes.map((m) => sentenceIndexOfBlank(session, m.blankIndex)),
  });

  const now = Date.now();
  // 文章级 FSRS（跨文练习不更新单篇调度：混编坐标对单篇无意义）
  if (!session.crossMode) {
    const prev = getFsrs(session.articleUuid);
    const state: CardState = prev ? { ...prev } : emptyCardState();
    const next = FsrsEngine.review(state, judgment.rating as Rating, now);
    setFsrs(session.articleUuid, next);
  }

  // 句子级 FSRS：仅对本次作答到的句子更新（字词/句子模式；跨文跳过）
  if (session.mode !== 'REVERSE' && !session.crossMode) {
    const touched = new Set<number>();
    for (const b of session.blanks) touched.add(b.sentenceIndex);
    for (const sIdx of touched) {
      // 用原文而非挖空文本作为句子键输入：字词模式的 sentences 含 ___，
      // 直接哈希会生成与「句选/句子记忆」口径不一致的孤立 FSRS 状态
      const sentence = session.sentenceOriginals[sIdx] || session.sentences[sIdx];
      if (!sentence || !sentence.trim()) continue;
      const key = sentenceFsrsKey(session.articleUuid, sentence);
      const prevState = getFsrs(key);
      const base: CardState = prevState ? { ...prevState } : emptyCardState();
      const sentenceRating = sentenceRatingFrom(session, judgment, sIdx);
      setFsrs(key, FsrsEngine.review(base, sentenceRating as Rating, now));
    }
  }

  discardProgress(session.articleUuid);
  // 埋点：练习完成（只上报数值与枚举，不含标题/正文）
  track('practice_complete', {
    mode: session.mode,
    blanks: judgment.totalBlanks,
    accuracy: Math.round(judgment.accuracy * 100),
    similarity: Math.round(judgment.similarity * 100),
    weakHints: session.weakHints,
    strongHints: session.strongHints,
    durationSec: Math.round(judgment.durationMs / 1000),
    cross: session.crossMode,
  });
  // 学习时长同步（排行榜口径：练习秒数写入 study_stat）
  scheduleSync();
  return record;
}

function sentenceRatingFrom(session: PracticeSession, judgment: Judgment, sentenceIndex: number): number {
  const wrong = judgment.mistakes.some((m) => sentenceIndexOfBlank(session, m.blankIndex) === sentenceIndex);
  if (!wrong) return FsrsEngine.gradeFromSimilarity(1) as number;
  return FsrsEngine.gradeFromSimilarity(0) as number;
}

function sentenceIndexOfBlank(session: PracticeSession, blankIndex: number): number {
  const blank = session.blanks.find((b) => b.index === blankIndex);
  return blank ? blank.sentenceIndex : 0;
}

/**
 * 本次实际作答句在全文中的字符起始位置（记忆热力图锚点）
 *
 * 口径说明（与 Android 端 buildSentenceAnchors 一致）：
 * - 用「原文」（sentenceOriginals）与全文切句比对，字词模式必须用回填后的原文，
 *   否则含 ___ 的文本永远匹配不到（曾出现的真实缺陷：锚点恒为空 → 热力图丢失
 *   "答对/未作答"区分）。
 * - 段落范围（薄弱集训/自选）下若按文本匹配失败，回退「按索引对齐」：
 *   会话内容与全文使用同一分句器，句序一致，可用全文第 N 句的起点近似。
 */
function collectAnsweredStarts(session: PracticeSession): number[] {
  if (session.mode === 'REVERSE') return [];
  const article = articleStore.find(session.articleUuid);
  if (!article) return [];
  const touched = new Set<number>();
  for (const b of session.blanks) {
    if ((session.answers[b.index] || '').trim().length > 0) touched.add(b.sentenceIndex);
  }
  return computeAnsweredStarts(article.content, session.sentenceOriginals, touched);
}

/** 空位难度（供"沉浸模式"与题目排序参考） */
export function blankDifficulty(blank: BlankRuntime): number {
  if (blank.answer.length === 1) return DifficultyCalculator.calculateCharDifficulty(blank.answer);
  const chars = Array.from(blank.answer);
  if (chars.length === 0) return 0;
  return chars.reduce((sum, ch) => sum + DifficultyCalculator.calculateCharDifficulty(ch), 0) / chars.length;
}

/** 空 FSRS 状态（首次复习） */
function emptyCardState(): CardState {
  return { difficulty: 0, stability: 0, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0 };
}

/** 供 UI 展示：把 displayText 拆成片段，占位符位置与 blanks 一一对应 */
export function splitDisplaySegments(displayText: string): string[] {
  return displayText.split('___');
}

// ============================== AI 坐标挖空 ==============================

/**
 * 用 AI 返回的坐标重建挖空（AI 只给坐标，内容由本地原文切片，杜绝改写）
 * - SENTENCE：coords = 句子编号数组
 * - WORD：coords = [{sentence, start, end}]（句内字符坐标，end 不含；作为"词块"整体挖空）
 * - REVERSE：coords = 选中的句子编号数组
 *
 * 长文处理（与 Kotlin 端一致）：单次请求只把全文前 `LIMITS.aiClozeMaxChars` 个字符发给 AI，
 * 因此 AI 看不到的尾部句子由**本地算法补齐**（否则长文只有前半部分有挖空）。
 *
 * 返回 false 表示坐标不可用（调用方应回退本地算法）
 */
export function applyAiCoords(
  session: PracticeSession,
  coords: number[] | Array<{ sentence: number; start: number; end: number }>
): boolean {
  const content = session.content;
  if (!content.trim()) return false;

  // AI 看不到的句子（起点超过发送上限）→ 交给本地算法补齐
  const unseen = new Set(unseenSentenceIndices(content, LIMITS.aiClozeMaxChars));

  if (session.mode === 'REVERSE') {
    const idx = new Set((Array.isArray(coords) ? coords : []).map((n) => Number(n)).filter((n) => Number.isFinite(n)));
    // AI 一个可用坐标都没给 → 整体回退本地算法（不能只练未覆盖区间）
    if (idx.size === 0) return false;
    // 未覆盖区间按本地行为补进默写范围
    for (const s of unseen) idx.add(s);
    const result = BlancallGenerator.buildCustomDictation(content, idx);
    if (result.clauses.length === 0) return false;
    applyDictation(session, result);
    session.clozeJson = BlancallGenerator.dictationToJson(result);
    return true;
  }

  const sentences = SentenceSplitter.split(content);
  const aiRanges = new Map<number, Array<{ first: number; last: number }>>();

  if (session.mode === 'WORD') {
    const list = Array.isArray(coords) ? coords : [];
    for (const c of list as Array<{ sentence: number; start: number; end: number }>) {
      if (!c || typeof c.sentence !== 'number' || typeof c.start !== 'number' || typeof c.end !== 'number') continue;
      const len = sentences[c.sentence] ? sentences[c.sentence].length : 0;
      if (len <= 0) continue;
      const start = Math.max(0, Math.min(c.start, len - 1));
      const end = Math.max(start + 1, Math.min(c.end, len));
      const arr = aiRanges.get(c.sentence) || [];
      arr.push({ first: start, last: end - 1 });
      aiRanges.set(c.sentence, arr);
    }
  } else {
    const list = Array.isArray(coords) ? coords : [];
    for (const n of list as number[]) {
      const idx = Number(n);
      const sentence = sentences[idx];
      if (!sentence || sentence.length <= 0) continue;
      const arr = aiRanges.get(idx) || [];
      arr.push({ first: 0, last: sentence.length - 1 });
      aiRanges.set(idx, arr);
    }
  }

  // AI 一个可用坐标都没给 → 整体回退本地算法（不能只练未覆盖区间）
  if (aiRanges.size === 0) return false;

  // 本地补齐：仅取 AI 未覆盖句子在会话本地挖空中的区间（AI 覆盖句仍以 AI 结果为准）
  const localRanges = rangesFromLocalBlanks(session.blanks, (sIdx) => unseen.has(sIdx));
  const ranges = mergeRanges(aiRanges, localRanges);

  if (ranges.size === 0) return false;
  const result = BlancallGenerator.buildCustomSentenceCloze(content, ranges);
  if (result.blanks.length === 0) return false;
  applySentence(session, result);
  session.clozeJson = BlancallGenerator.sentenceClozeToJson(result);
  return true;
}

// ============================== 提示计数 ==============================

/** 计数一次弱提示（淡显） */
export function countWeakHint(session: PracticeSession): void {
  session.weakHints += 1;
}

/** 计数一次强提示（自动填入） */
export function countStrongHint(session: PracticeSession): void {
  session.strongHints += 1;
}

/** 已完成空数（用于进度条与统计） */
export function answeredCount(session: PracticeSession): number {
  if (session.mode === 'REVERSE') return session.dictationInput.trim().length > 0 ? 1 : 0;
  let n = 0;
  for (const b of session.blanks) {
    if ((session.answers[b.index] || '').trim().length > 0) n += 1;
  }
  return n;
}

/** 是否全部作答（用于"完整提交"判定） */
export function isAllAnswered(session: PracticeSession): boolean {
  if (session.mode === 'REVERSE') return session.dictationInput.trim().length > 0;
  return session.blanks.every((b) => (session.answers[b.index] || '').trim().length > 0);
}