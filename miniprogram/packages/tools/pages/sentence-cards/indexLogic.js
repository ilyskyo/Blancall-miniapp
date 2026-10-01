"use strict";
/**
 * 每日句卡纯逻辑：句级 FSRS 状态收集 / 轮转抽句 / 卡片构建
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.today = exports.pickNextCard = exports.toCardPayload = exports.sentenceStates = void 0;
const sentenceSelector_1 = require("../../../../core/algorithms/sentenceSelector");
const date_1 = require("../../../../core/utils/date");
/** 从 FSRS 记录中筛出句子级状态（键前缀 s:） */
function sentenceStates(records) {
    const m = new Map();
    for (const r of records)
        if (r.key.startsWith('s:'))
            m.set(r.key, r);
    return m;
}
exports.sentenceStates = sentenceStates;
/** 抽中句 → 句卡实体载荷 */
function toCardPayload(pick, articles, date) {
    const article = articles.find((a) => a.uuid === pick.articleId);
    return {
        date,
        key: pick.key,
        articleUuid: pick.articleId,
        text: pick.text,
        start: pick.start,
        end: pick.end,
        title: article ? article.title : '',
    };
}
exports.toCardPayload = toCardPayload;
/** 随机抽一句（排除指定键），用于「换一句」兜底 */
function randomPick(articles, states, excludeKey, rng) {
    const pool = [];
    for (const article of articles) {
        for (const c of sentenceSelector_1.SentenceSelector.candidates(article)) {
            if (c.key === excludeKey)
                continue;
            pool.push(c);
        }
    }
    if (pool.length === 0)
        return null;
    const fresh = pool.filter((c) => !states.has(c.key));
    const list = fresh.length > 0 ? fresh : pool;
    const idx = rng ? rng.nextInt(list.length) : Math.floor(Math.random() * list.length);
    return list[idx];
}
/**
 * 抽取下一张句卡：优先轮转规则 pickNew；当结果与 excludeKey 相同（换一句场景）时改随机抽不同的句子。
 */
function pickNextCard(articles, records, excludeKey = '') {
    const states = sentenceStates(records);
    const pick = sentenceSelector_1.SentenceSelector.pickNew(articles, states);
    if (pick && (!excludeKey || pick.key !== excludeKey))
        return pick;
    return randomPick(articles, states, excludeKey);
}
exports.pickNextCard = pickNextCard;
/** 今日卡片展示文案 */
function today() {
    return (0, date_1.dateKey)();
}
exports.today = today;
