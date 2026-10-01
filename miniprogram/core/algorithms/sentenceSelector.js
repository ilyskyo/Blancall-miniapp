"use strict";
/**
 * 「句子卡片」抽句器（移植自 Android 端 `algorithm/SentenceSelector.kt`，逐行对齐）
 *
 * 从文章全文切句中筛选合格句，并决定每日抽哪一句。全部为纯函数。
 *
 * ## 句子身份
 * 键 = `s:<articleUuid>:<hash16>`，hash16 = SHA-256(trim 后句文) 前 8 字节 hex。
 * 用**文本哈希而非位置**：文章编辑后位置漂移不会串句；同文章同文本的重复句
 * 共享同一记忆状态（天然去重）。
 *
 * ## 抽句策略
 * - 到期优先：有到期句子状态时取最逾期者（pickDue）；
 * - 新句兜底：无到期时 pickNew 随机新抽，优先"最久未抽过句子的文章"，
 *   已有状态的句子不再作为新句抽取；全部抽过时兜底取 lastReview 最早者。
 *
 * Kotlin→TS：原 Long articleId → uuid 字符串。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SentenceSelector = void 0;
const types_1 = require("./types");
const digest_1 = require("../utils/digest");
const fsrs_1 = require("./fsrs");
const sentence_1 = require("./sentence");
/** 合格句长度范围（字符数，trim 后）：过短无记忆价值，过长卡片放不下 */
const MIN_LEN = 6;
const MAX_LEN = 80;
/** 文章轮转候选数：取"最久未抽过句子"的前 N 篇内随机，兼顾跨文章分布与随机性 */
const ROTATION_TOP = 3;
/** 默认随机源（对应 Random.Default） */
const defaultRng = {
    nextInt(bound) {
        return Math.floor(Math.random() * bound);
    },
};
/** Fisher-Yates 洗牌（对应 Kotlin List.shuffled(rng)） */
function shuffled(list, rng) {
    const a = list.slice();
    for (let i = a.length; i > 1; i--) {
        const j = rng.nextInt(i);
        const tmp = a[i - 1];
        a[i - 1] = a[j];
        a[j] = tmp;
    }
    return a;
}
/** 汉字区间与字母判定（对应 Kotlin `it in '\u4e00'..'\u9fff' || it.isLetter()`，按 UTF-16 码元） */
function isContentChar(ch) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fff)
        return true;
    return /\p{L}/u.test(ch);
}
exports.SentenceSelector = {
    /** 句子键前缀（单一来源在 types.ts） */
    SENTENCE_KEY_PREFIX: types_1.SENTENCE_KEY_PREFIX,
    /** 句子键：`s:<articleUuid>:<hash16>`（hash16 = SHA-256(句文) 前 8 字节 hex） */
    sentenceKey(articleUuid, text) {
        return `${types_1.SENTENCE_KEY_PREFIX}${articleUuid}:${(0, digest_1.hash16)(text)}`;
    },
    /** 从句子键解析所属文章 uuid（脏键返回 null） */
    articleIdOf(key) {
        if (!key.startsWith(types_1.SENTENCE_KEY_PREFIX))
            return null;
        const parts = key.split(':');
        if (parts.length !== 3 || parts[2].trim() === '' || parts[1] === '')
            return null;
        return parts[1];
    },
    /**
     * 句子是否合格：trim 后长度 6..80，且至少含 2 个汉字或字母
     * （滤掉目录编号、页码、纯标点等无记忆价值的"句子"）。
     */
    isEligible(text) {
        const t = text.trim();
        if (t.length < MIN_LEN || t.length > MAX_LEN)
            return false;
        let contentCount = 0;
        for (let i = 0; i < t.length; i++) {
            if (isContentChar(t[i]))
                contentCount++;
        }
        return contentCount >= 2;
    },
    /**
     * 文章全文切句 → 合格句候选（与练习全文切句口径 SentenceSplitter.splitWithPositions 一致）。
     * 同文本重复句按 hash 去重，只保留首处位置（供展示定位）。
     */
    candidates(article) {
        const seen = new Set();
        const out = [];
        for (const s of sentence_1.SentenceSplitter.splitWithPositions(article.content)) {
            if (!this.isEligible(s.text))
                continue;
            const key = this.sentenceKey(article.uuid, s.text);
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push({ key, articleId: article.uuid, text: s.text, start: s.startIndex, end: s.endIndex });
        }
        return out;
    },
    /** 到期集合中取最逾期者（due 最小）；无到期返回 null */
    pickDue(states, now) {
        let best = null;
        let bestDue = Number.POSITIVE_INFINITY;
        for (const [key, state] of states) {
            if (!key.startsWith(types_1.SENTENCE_KEY_PREFIX))
                continue;
            if (!fsrs_1.FsrsEngine.isDue(state, now))
                continue;
            if (state.due < bestDue) {
                bestDue = state.due;
                best = key;
            }
        }
        return best;
    },
    /** 按文章聚合"最近一次句级复习时间"，无记录返回空 */
    lastReviewByArticle(states) {
        const out = new Map();
        for (const [key, state] of states) {
            const aid = this.articleIdOf(key);
            if (aid === null)
                continue;
            const cur = out.get(aid);
            if (cur === undefined || state.lastReview > cur)
                out.set(aid, state.lastReview);
        }
        return out;
    },
    /**
     * 随机抽新句：优先"最久未抽过句子的文章"（按 lastReviewByArticle 升序取前 ROTATION_TOP 篇随机），
     * 每篇文章候选去掉已抽过的句子后随机取一；全库都抽过时兜底取 lastReview 最早的句子；
     * 无文章 / 无合格句 / 全库抽过但无任何状态时返回 null。
     */
    pickNew(articles, states, rng = defaultRng) {
        if (articles.length === 0)
            return null;
        const lastReview = this.lastReviewByArticle(states);
        const ordered = articles.slice().sort((a, b) => { var _a, _b; return ((_a = lastReview.get(a.uuid)) !== null && _a !== void 0 ? _a : 0) - ((_b = lastReview.get(b.uuid)) !== null && _b !== void 0 ? _b : 0); });
        const head = shuffled(ordered.slice(0, ROTATION_TOP), rng).concat(ordered.slice(ROTATION_TOP));
        let fallback = null;
        let fallbackLast = Number.MAX_SAFE_INTEGER;
        for (const article of head) {
            const cands = this.candidates(article);
            if (cands.length === 0)
                continue;
            const fresh = cands.filter((c) => !states.has(c.key));
            if (fresh.length > 0)
                return fresh[rng.nextInt(fresh.length)];
            // 本文章全抽过：记录 lastReview 最早的句子作为兜底
            for (const c of cands) {
                const st = states.get(c.key);
                if (st === undefined)
                    continue;
                const last = st.lastReview;
                if (last < fallbackLast) {
                    fallbackLast = last;
                    fallback = c;
                }
            }
        }
        return fallback;
    },
};
