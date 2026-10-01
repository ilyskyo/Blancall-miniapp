"use strict";
/**
 * 练习会话引擎
 *
 * 职责：把「算法（分句/挖空/判定/评分/FSRS）」与「存储（进度/记录/统计）」串起来，
 * 页面只负责渲染与输入采集，所有规则口径集中在这里，保证与 Android 端功能等价。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAllAnswered = exports.answeredCount = exports.countStrongHint = exports.countWeakHint = exports.applyAiCoords = exports.splitDisplaySegments = exports.blankDifficulty = exports.commitSession = exports.listInProgress = exports.restoreSession = exports.discardProgress = exports.persistProgress = exports.applyStrongHint = exports.pickHintBlank = exports.nextHint = exports.judgeSession = exports.setDictationInput = exports.setAnswer = exports.startSession = exports.buildErrorProfile = void 0;
const sentence_1 = require("../algorithms/sentence");
const section_1 = require("../algorithms/section");
const cloze_1 = require("../algorithms/cloze");
const answer_1 = require("../algorithms/answer");
const dictation_1 = require("../algorithms/dictation");
const fsrs_1 = require("../algorithms/fsrs");
const difficulty_1 = require("../algorithms/difficulty");
const types_1 = require("../algorithms/types");
const entities_1 = require("../storage/entities");
const sync_1 = require("../net/sync");
const telemetry_1 = require("../telemetry");
// ============================== 错误画像 ==============================
/** 从历史记录构造挖空权重（错误率 + 记忆强度因子） */
function buildErrorProfile(articleUuid, now = Date.now()) {
    const records = (0, entities_1.recordsOfArticle)(articleUuid);
    const profile = (0, types_1.emptyErrorProfile)();
    if (records.length === 0)
        return profile;
    const article = entities_1.articleStore.find(articleUuid);
    const sentenceCount = article ? sentence_1.SentenceSplitter.split(article.content).length : 0;
    const sentenceHits = new Map();
    const sentenceTotal = new Map();
    const charHits = new Map();
    const charTotal = new Map();
    const wordHits = new Map();
    const wordTotal = new Map();
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
                    if (!m.userAnswer.includes(ch))
                        charHits.set(ch, (charHits.get(ch) || 0) + 1);
                }
            }
            const words = correct.toLowerCase().match(/[a-z]+/g) || [];
            for (const w of words) {
                wordTotal.set(w, (wordTotal.get(w) || 0) + 1);
                if (!m.userAnswer.toLowerCase().includes(w))
                    wordHits.set(w, (wordHits.get(w) || 0) + 1);
            }
        }
    }
    sentenceTotal.forEach((total, idx) => {
        if (total > 0)
            profile.sentenceErrorRates[idx] = (sentenceHits.get(idx) || 0) / total;
    });
    charTotal.forEach((total, ch) => {
        if (total > 0)
            profile.charErrorRates[ch] = (charHits.get(ch) || 0) / total;
    });
    wordTotal.forEach((total, w) => {
        if (total > 0)
            profile.wordErrorRates[w] = (wordHits.get(w) || 0) / total;
    });
    // 记忆强度因子：文章级 FSRS 留存率
    const state = (0, entities_1.getFsrs)(articleUuid);
    if (state) {
        const retention = fsrs_1.FsrsEngine.retentionRate(state, now);
        let factor = 1;
        if (retention < 0.5)
            factor = 1.45;
        else if (retention < 0.7)
            factor = 1.25;
        else if (retention < 0.85)
            factor = 1.1;
        if ((state.lapses || 0) >= 2)
            factor += 0.1;
        profile.memoryFactor = Math.min(1.6, Math.max(1, factor));
    }
    return profile;
}
exports.buildErrorProfile = buildErrorProfile;
// ============================== 段落范围 ==============================
function resolveContent(articleUuid, options) {
    const article = entities_1.articleStore.find(articleUuid);
    if (!article)
        return { content: options.contentOverride || '', sections: [] };
    const full = options.contentOverride || article.content;
    const sections = section_1.SectionSplitter.split(full);
    const mode = options.sectionMode || 'FULL';
    if (mode === 'FULL' || sections.length === 0)
        return { content: full, sections };
    if (mode === 'SELECTED') {
        const picked = (options.selectedSections || []).filter((i) => i >= 0 && i < sections.length);
        if (picked.length === 0)
            return { content: full, sections };
        const content = picked
            .sort((a, b) => a - b)
            .map((i) => sections[i].contentOnly)
            .join('\n\n');
        return { content, sections };
    }
    // WEAKNESS：按句级错误率排序，取有错误史的段落；无历史则回退全文
    const profile = buildErrorProfile(articleUuid);
    const ranked = section_1.SectionSplitter.rankByErrorRate(sections, profile.sentenceErrorRates);
    const weak = ranked.filter((r) => r.errorRate > 0).sort((a, b) => b.errorRate - a.errorRate);
    if (weak.length === 0)
        return { content: full, sections };
    const content = weak
        .map((r) => r.section)
        .sort((a, b) => a.index - b.index)
        .map((s) => s.contentOnly)
        .join('\n\n');
    return { content, sections };
}
// ============================== 会话构建 ==============================
// 空位映射与锚点计算集中在纯函数模块（可单测；修复过字词模式句级归因与锚点缺陷）
const blankMapping_1 = require("./blankMapping");
const config_1 = require("../config");
/** 句子挖空 → 运行时空位（SentenceBlankInfo 自带句索引） */
function toBlankRuntimeFromSentence(result) {
    return (0, blankMapping_1.mapSentenceBlanks)(result);
}
/** 字词挖空 → 运行时空位（由 sentences[].blanks 反推句索引） */
function toBlankRuntimeFromWord(result) {
    return (0, blankMapping_1.mapWordBlanks)(result);
}
/** 开始（或恢复）一次练习 */
function startSession(options) {
    const { content, sections } = resolveContent(options.articleUuid, options);
    const mode = options.mode;
    const strategy = options.strategy || 'BALANCED';
    const configUuid = options.configUuid || '';
    const profile = buildErrorProfile(options.articleUuid);
    const session = {
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
    let warning;
    // 自定义挖空配置优先
    const customConfig = configUuid
        ? (0, entities_1.customClozeOfArticle)(options.articleUuid).find((c) => c.uuid === configUuid) || null
        : null;
    if (customConfig) {
        if (customConfig.mode === 'REVERSE') {
            const sentenceIdx = new Set(customConfig.levels || []);
            const result = cloze_1.BlancallGenerator.buildCustomDictation(content, sentenceIdx);
            applyDictation(session, result);
            session.clozeJson = cloze_1.BlancallGenerator.dictationToJson(result);
        }
        else {
            const ranges = new Map();
            for (const b of customConfig.blanks || []) {
                const list = ranges.get(b.s) || [];
                list.push({ first: b.a, last: Math.max(b.a, b.b - 1) });
                ranges.set(b.s, list);
            }
            const result = cloze_1.BlancallGenerator.buildCustomSentenceCloze(content, ranges);
            applySentence(session, result);
            session.clozeJson = cloze_1.BlancallGenerator.sentenceClozeToJson(result);
        }
    }
    else if (mode === 'REVERSE') {
        const result = cloze_1.BlancallGenerator.generateDictation(content);
        if (result.clauses.length === 0)
            warning = '内容过短，无法生成反向默写';
        applyDictation(session, result);
        session.clozeJson = cloze_1.BlancallGenerator.dictationToJson(result);
    }
    else if (mode === 'WORD') {
        const result = cloze_1.BlancallGenerator.generateWordCloze(content, options.count || 0, profile, strategy, options.classicalMode);
        applyWord(session, result);
        session.clozeJson = cloze_1.BlancallGenerator.wordClozeToJson(result);
    }
    else {
        const result = cloze_1.BlancallGenerator.generateSentenceCloze(content, options.count || 0, profile, strategy);
        applySentence(session, result);
        session.clozeJson = cloze_1.BlancallGenerator.sentenceClozeToJson(result);
    }
    if (sections.length === 0 && !content.trim())
        warning = '文章内容为空';
    return { session, warning };
}
exports.startSession = startSession;
function applySentence(session, result) {
    session.sentences = result.sentences;
    // 句子模式的 sentences 即原句（未挖空），可直接作为锚点匹配源
    session.sentenceOriginals = result.sentences.slice();
    session.displayText = result.displayText;
    session.blanks = toBlankRuntimeFromSentence(result);
    session.maxBlanks = session.blanks.length;
    session.suggestedBlanks = session.blanks.length;
}
function applyWord(session, result) {
    session.blanks = toBlankRuntimeFromWord(result);
    session.sentences = result.sentences.map((s) => s.text);
    // 字词模式 text 已挖空：按答案回填 ___ 还原原文，供记忆热力图的字符锚点匹配
    session.sentenceOriginals = (0, blankMapping_1.wordSentenceOriginals)(result.sentences || [], session.blanks);
    session.displayText = result.displayText;
    session.maxBlanks = result.maxBlanks;
    session.suggestedBlanks = result.suggestedBlanks;
}
function applyDictation(session, result) {
    session.sentences = result.clauses;
    session.sentenceOriginals = [];
    session.dictation = { clauses: result.clauses, shuffled: result.shuffledClauses };
    session.blanks = [];
    session.displayText = result.clauses.join('');
}
// ============================== 作答与判定 ==============================
function setAnswer(session, blankIndex, value) {
    session.answers[blankIndex] = value;
}
exports.setAnswer = setAnswer;
function setDictationInput(session, value) {
    session.dictationInput = value;
}
exports.setDictationInput = setDictationInput;
/** 判定：句子/字词模式逐空；反向默写整段双通道评分 */
function judgeSession(session, now = Date.now()) {
    const startedAt = session.startedAt;
    if (session.mode === 'REVERSE') {
        const clauses = session.dictation ? session.dictation.clauses : session.sentences;
        const input = session.dictationInput;
        const detail = answer_1.AnswerChecker.checkDictation(clauses, input);
        const similarity = dictation_1.DictationScorer.score(clauses.join(''), input);
        const total = clauses.length || 1;
        const correctCount = detail.sentences.filter((s) => s.result === 'CORRECT').length;
        const accuracy = correctCount / total;
        const useSimilarity = true;
        const rating = useSimilarity ? fsrs_1.FsrsEngine.gradeFromSimilarity(similarity) : fsrs_1.FsrsEngine.ratingFromAccuracy(accuracy);
        const mistakes = detail.sentences
            .map((s, i) => ({ s, i }))
            .filter((it) => it.s.result !== 'CORRECT')
            .map((it) => ({
            blankIndex: it.i,
            correctAnswer: it.s.matchedOriginal || clauses[it.i] || '',
            userAnswer: it.s.userText || '',
            errorType: 'TYPO',
        }));
        return {
            correctCount,
            totalBlanks: clauses.length,
            similarity,
            rating: rating,
            mistakes,
            perBlank: {},
            dictationDetail: detail,
            accuracy,
            durationMs: now - startedAt,
        };
    }
    const perBlank = {};
    const mistakes = [];
    let correctCount = 0;
    let similaritySum = 0;
    for (const blank of session.blanks) {
        const user = (session.answers[blank.index] || '').trim();
        const detail = answer_1.AnswerChecker.check(blank.answer, user);
        perBlank[blank.index] = detail;
        similaritySum += detail.similarity;
        if (detail.result === 'CORRECT')
            correctCount++;
        else {
            mistakes.push({
                blankIndex: blank.index,
                correctAnswer: blank.answer,
                userAnswer: user,
                errorType: detail.result === 'INCORRECT' ? 'TYPO' : detail.result,
            });
        }
    }
    const total = session.blanks.length || 1;
    const accuracy = correctCount / total;
    const similarity = session.blanks.length > 0 ? similaritySum / session.blanks.length : 0;
    const rating = fsrs_1.FsrsEngine.gradeFromSimilarity(similarity);
    return {
        correctCount,
        totalBlanks: session.blanks.length,
        similarity,
        rating: rating,
        mistakes,
        perBlank,
        accuracy,
        durationMs: now - startedAt,
    };
}
exports.judgeSession = judgeSession;
// ============================== 提示系统 ==============================
/**
 * 下一个应提示的字（弱提示：淡显；强提示：自动填入）
 * - 句子/字词模式：按当前空的答案与已输入内容推进
 * - 反向默写：按原文顺序推进
 * 返回 null 表示无需提示（已填完或已到达末尾）
 */
function nextHint(session, blankIndex) {
    if (session.mode === 'REVERSE') {
        const full = (session.dictation ? session.dictation.clauses.join('') : session.sentences.join(''));
        const input = session.dictationInput;
        if (input.length >= full.length)
            return null;
        return { blankIndex: null, char: full.charAt(input.length) };
    }
    const target = pickHintBlank(session, blankIndex);
    if (target === null)
        return null;
    const blank = session.blanks.find((b) => b.index === target);
    if (!blank)
        return null;
    const typed = session.answers[target] || '';
    if (typed.length >= blank.answer.length)
        return null;
    return { blankIndex: target, char: blank.answer.charAt(typed.length) };
}
exports.nextHint = nextHint;
/** 选择要提示的空：优先当前聚焦空；否则第一个未填完的空 */
function pickHintBlank(session, blankIndex) {
    if (blankIndex !== null) {
        const b = session.blanks.find((it) => it.index === blankIndex);
        if (b && (session.answers[b.index] || '').length < b.answer.length)
            return b.index;
        return null;
    }
    for (const b of session.blanks) {
        if ((session.answers[b.index] || '').length < b.answer.length)
            return b.index;
    }
    return null;
}
exports.pickHintBlank = pickHintBlank;
/** 强提示：把下一个字写入答案（由页面调用后 setData 刷新） */
function applyStrongHint(session, blankIndex) {
    const hint = nextHint(session, blankIndex);
    if (!hint)
        return null;
    if (hint.blankIndex === null) {
        session.dictationInput = `${session.dictationInput}${hint.char}`;
    }
    else {
        session.answers[hint.blankIndex] = `${session.answers[hint.blankIndex] || ''}${hint.char}`;
    }
    return hint;
}
exports.applyStrongHint = applyStrongHint;
// ============================== 进度持久化（断点续练） ==============================
/** 仅在「部分提交」时落盘（与 Android 端一致：完整提交后清除） */
function persistProgress(session, judgment) {
    const answeredCount = session.mode === 'REVERSE' ? (session.dictationInput ? 1 : 0) : Object.keys(session.answers).filter((k) => (session.answers[Number(k)] || '').trim()).length;
    (0, entities_1.saveProgress)({
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
    (0, sync_1.scheduleSync)();
}
exports.persistProgress = persistProgress;
function discardProgress(articleUuid) {
    (0, entities_1.clearProgress)(articleUuid);
    (0, sync_1.scheduleSync)();
}
exports.discardProgress = discardProgress;
/** 从断点恢复会话（复用原挖空，避免重新生成导致内容变化） */
function restoreSession(articleUuid, mode) {
    const state = (0, entities_1.getProgress)(articleUuid);
    if (!state || state.status !== 'IN_PROGRESS')
        return null;
    const options = {
        articleUuid,
        mode: (mode || state.mode),
        configUuid: state.configUuid || '',
    };
    const { session } = startSession(options);
    // 复用原挖空：以保存的 clozeJson 为准
    if (state.clozeJson) {
        try {
            if (session.mode === 'REVERSE') {
                const parsed = cloze_1.BlancallGenerator.dictationFromJson(state.clozeJson);
                if (parsed)
                    applyDictation(session, parsed);
            }
            else if (session.mode === 'WORD') {
                const parsed = cloze_1.BlancallGenerator.wordClozeFromJson(state.clozeJson);
                if (parsed)
                    applyWord(session, parsed);
            }
            else {
                const parsed = cloze_1.BlancallGenerator.sentenceClozeFromJson(state.clozeJson);
                if (parsed)
                    applySentence(session, parsed);
            }
            session.clozeJson = state.clozeJson;
        }
        catch {
            /* 解析失败则使用重新生成的挖空 */
        }
    }
    session.answers = { ...state.answers };
    session.dictationInput = state.dictationInput || '';
    session.startedAt = state.lastPracticeTime || Date.now();
    // 配置已被删除时提示降级
    if (state.configUuid && !(0, entities_1.customClozeOfArticle)(articleUuid).some((c) => c.uuid === state.configUuid)) {
        session.configUuid = '';
    }
    return session;
}
exports.restoreSession = restoreSession;
/** 首页「继续练习」：扫描进行中的练习 */
function listInProgress() {
    const out = [];
    for (const state of (0, entities_1.inProgressStates)()) {
        const article = entities_1.articleStore.find(state.articleUuid);
        out.push({ state, articleTitle: article ? article.title : '(已删除)' });
    }
    return out;
}
exports.listInProgress = listInProgress;
// ============================== 提交落库 ==============================
/** 完成一次练习：写记录 + 更新 FSRS（文章级与句子级） */
function commitSession(session, judgment) {
    const record = (0, entities_1.appendRecord)({
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
        const prev = (0, entities_1.getFsrs)(session.articleUuid);
        const state = prev ? { ...prev } : emptyCardState();
        const next = fsrs_1.FsrsEngine.review(state, judgment.rating, now);
        (0, entities_1.setFsrs)(session.articleUuid, next);
    }
    // 句子级 FSRS：仅对本次作答到的句子更新（字词/句子模式；跨文跳过）
    if (session.mode !== 'REVERSE' && !session.crossMode) {
        const touched = new Set();
        for (const b of session.blanks)
            touched.add(b.sentenceIndex);
        for (const sIdx of touched) {
            // 用原文而非挖空文本作为句子键输入：字词模式的 sentences 含 ___，
            // 直接哈希会生成与「句选/句子记忆」口径不一致的孤立 FSRS 状态
            const sentence = session.sentenceOriginals[sIdx] || session.sentences[sIdx];
            if (!sentence || !sentence.trim())
                continue;
            const key = (0, entities_1.sentenceFsrsKey)(session.articleUuid, sentence);
            const prevState = (0, entities_1.getFsrs)(key);
            const base = prevState ? { ...prevState } : emptyCardState();
            const sentenceRating = sentenceRatingFrom(session, judgment, sIdx);
            (0, entities_1.setFsrs)(key, fsrs_1.FsrsEngine.review(base, sentenceRating, now));
        }
    }
    discardProgress(session.articleUuid);
    // 埋点：练习完成（只上报数值与枚举，不含标题/正文）
    (0, telemetry_1.track)('practice_complete', {
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
    (0, sync_1.scheduleSync)();
    return record;
}
exports.commitSession = commitSession;
function sentenceRatingFrom(session, judgment, sentenceIndex) {
    const wrong = judgment.mistakes.some((m) => sentenceIndexOfBlank(session, m.blankIndex) === sentenceIndex);
    if (!wrong)
        return fsrs_1.FsrsEngine.gradeFromSimilarity(1);
    return fsrs_1.FsrsEngine.gradeFromSimilarity(0);
}
function sentenceIndexOfBlank(session, blankIndex) {
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
function collectAnsweredStarts(session) {
    if (session.mode === 'REVERSE')
        return [];
    const article = entities_1.articleStore.find(session.articleUuid);
    if (!article)
        return [];
    const touched = new Set();
    for (const b of session.blanks) {
        if ((session.answers[b.index] || '').trim().length > 0)
            touched.add(b.sentenceIndex);
    }
    return (0, blankMapping_1.computeAnsweredStarts)(article.content, session.sentenceOriginals, touched);
}
/** 空位难度（供"沉浸模式"与题目排序参考） */
function blankDifficulty(blank) {
    if (blank.answer.length === 1)
        return difficulty_1.DifficultyCalculator.calculateCharDifficulty(blank.answer);
    const chars = Array.from(blank.answer);
    if (chars.length === 0)
        return 0;
    return chars.reduce((sum, ch) => sum + difficulty_1.DifficultyCalculator.calculateCharDifficulty(ch), 0) / chars.length;
}
exports.blankDifficulty = blankDifficulty;
/** 空 FSRS 状态（首次复习） */
function emptyCardState() {
    return { difficulty: 0, stability: 0, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0 };
}
/** 供 UI 展示：把 displayText 拆成片段，占位符位置与 blanks 一一对应 */
function splitDisplaySegments(displayText) {
    return displayText.split('___');
}
exports.splitDisplaySegments = splitDisplaySegments;
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
function applyAiCoords(session, coords) {
    const content = session.content;
    if (!content.trim())
        return false;
    // AI 看不到的句子（起点超过发送上限）→ 交给本地算法补齐
    const unseen = new Set((0, blankMapping_1.unseenSentenceIndices)(content, config_1.LIMITS.aiClozeMaxChars));
    if (session.mode === 'REVERSE') {
        const idx = new Set((Array.isArray(coords) ? coords : []).map((n) => Number(n)).filter((n) => Number.isFinite(n)));
        // AI 一个可用坐标都没给 → 整体回退本地算法（不能只练未覆盖区间）
        if (idx.size === 0)
            return false;
        // 未覆盖区间按本地行为补进默写范围
        for (const s of unseen)
            idx.add(s);
        const result = cloze_1.BlancallGenerator.buildCustomDictation(content, idx);
        if (result.clauses.length === 0)
            return false;
        applyDictation(session, result);
        session.clozeJson = cloze_1.BlancallGenerator.dictationToJson(result);
        return true;
    }
    const sentences = sentence_1.SentenceSplitter.split(content);
    const aiRanges = new Map();
    if (session.mode === 'WORD') {
        const list = Array.isArray(coords) ? coords : [];
        for (const c of list) {
            if (!c || typeof c.sentence !== 'number' || typeof c.start !== 'number' || typeof c.end !== 'number')
                continue;
            const len = sentences[c.sentence] ? sentences[c.sentence].length : 0;
            if (len <= 0)
                continue;
            const start = Math.max(0, Math.min(c.start, len - 1));
            const end = Math.max(start + 1, Math.min(c.end, len));
            const arr = aiRanges.get(c.sentence) || [];
            arr.push({ first: start, last: end - 1 });
            aiRanges.set(c.sentence, arr);
        }
    }
    else {
        const list = Array.isArray(coords) ? coords : [];
        for (const n of list) {
            const idx = Number(n);
            const sentence = sentences[idx];
            if (!sentence || sentence.length <= 0)
                continue;
            const arr = aiRanges.get(idx) || [];
            arr.push({ first: 0, last: sentence.length - 1 });
            aiRanges.set(idx, arr);
        }
    }
    // AI 一个可用坐标都没给 → 整体回退本地算法（不能只练未覆盖区间）
    if (aiRanges.size === 0)
        return false;
    // 本地补齐：仅取 AI 未覆盖句子在会话本地挖空中的区间（AI 覆盖句仍以 AI 结果为准）
    const localRanges = (0, blankMapping_1.rangesFromLocalBlanks)(session.blanks, (sIdx) => unseen.has(sIdx));
    const ranges = (0, blankMapping_1.mergeRanges)(aiRanges, localRanges);
    if (ranges.size === 0)
        return false;
    const result = cloze_1.BlancallGenerator.buildCustomSentenceCloze(content, ranges);
    if (result.blanks.length === 0)
        return false;
    applySentence(session, result);
    session.clozeJson = cloze_1.BlancallGenerator.sentenceClozeToJson(result);
    return true;
}
exports.applyAiCoords = applyAiCoords;
// ============================== 提示计数 ==============================
/** 计数一次弱提示（淡显） */
function countWeakHint(session) {
    session.weakHints += 1;
}
exports.countWeakHint = countWeakHint;
/** 计数一次强提示（自动填入） */
function countStrongHint(session) {
    session.strongHints += 1;
}
exports.countStrongHint = countStrongHint;
/** 已完成空数（用于进度条与统计） */
function answeredCount(session) {
    if (session.mode === 'REVERSE')
        return session.dictationInput.trim().length > 0 ? 1 : 0;
    let n = 0;
    for (const b of session.blanks) {
        if ((session.answers[b.index] || '').trim().length > 0)
            n += 1;
    }
    return n;
}
exports.answeredCount = answeredCount;
/** 是否全部作答（用于"完整提交"判定） */
function isAllAnswered(session) {
    if (session.mode === 'REVERSE')
        return session.dictationInput.trim().length > 0;
    return session.blanks.every((b) => (session.answers[b.index] || '').trim().length > 0);
}
exports.isAllAnswered = isAllAnswered;
