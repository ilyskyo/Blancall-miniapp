"use strict";
/**
 * 统计聚合（对应 Android 端 OverviewScreen / StatisticsScreen 的口径）
 *
 * 说明：所有指标都从本地记录/FSRS 计算；学习时长与排行榜共用 study_stat。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatStudy = exports.tagDistribution = exports.achievements = exports.dueSoon = exports.sentenceMemory = exports.articleStats = exports.weakestArticles = exports.progressTrend = exports.modeComparison = exports.weaknessProfile = exports.calendar = exports.dailyTrend = exports.globalStats = void 0;
const achievement_1 = require("../algorithms/achievement");
const forgetting_1 = require("../algorithms/forgetting");
const fsrs_1 = require("../algorithms/fsrs");
const template_1 = require("../review/template");
const entities_1 = require("../storage/entities");
const date_1 = require("../utils/date");
/** 学习日集合（练习或阅读 ≥1 分钟才算当日有效） */
function activeDays() {
    const days = new Set();
    for (const s of entities_1.studyStatStore.list()) {
        if ((s.practiceSeconds || 0) + (s.readingSeconds || 0) >= 60)
            days.add(s.date);
    }
    for (const r of entities_1.recordStore.list())
        days.add((0, date_1.dateKey)(r.timestamp));
    return days;
}
function computeStreaks() {
    const days = Array.from(activeDays()).sort();
    if (days.length === 0)
        return { streak: 0, longest: 0 };
    let longest = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        const prev = new Date(`${days[i - 1]}T00:00:00`).getTime();
        const cur = new Date(`${days[i]}T00:00:00`).getTime();
        if (Math.round((cur - prev) / date_1.MILLIS_PER_DAY) === 1)
            run += 1;
        else
            run = 1;
        longest = Math.max(longest, run);
    }
    // 当前连续：从今天或昨天往前推
    const today = (0, date_1.dateKey)();
    const yesterday = (0, date_1.dateKey)(Date.now() - date_1.MILLIS_PER_DAY);
    let streak = 0;
    if (days.includes(today) || days.includes(yesterday)) {
        let cursor = days.includes(today) ? today : yesterday;
        while (days.includes(cursor)) {
            streak += 1;
            cursor = (0, date_1.dateKey)(new Date(`${cursor}T00:00:00`).getTime() - date_1.MILLIS_PER_DAY);
        }
    }
    return { streak, longest };
}
function globalStats() {
    const records = entities_1.recordStore.list();
    const totalBlanks = records.reduce((s, r) => s + r.totalBlanks, 0);
    const totalCorrect = records.reduce((s, r) => s + r.correctCount, 0);
    const practiceSeconds = records.reduce((s, r) => s + Math.round((r.duration || 0) / 1000), 0);
    const readingSeconds = entities_1.studyStatStore.list().reduce((s, it) => s + (it.readingSeconds || 0), 0);
    const { streak, longest } = computeStreaks();
    const today = (0, date_1.dateKey)();
    const todayRecords = records.filter((r) => (0, date_1.dateKey)(r.timestamp) === today);
    const articleIds = new Set(records.map((r) => r.articleUuid));
    const todayStat = entities_1.studyStatStore.find(today);
    return {
        accuracy: totalBlanks > 0 ? totalCorrect / totalBlanks : 0,
        practiceCount: records.length,
        articleCount: articleIds.size,
        totalBlanks,
        studySeconds: practiceSeconds + readingSeconds,
        readingSeconds,
        streak,
        longestStreak: longest,
        todayCount: todayRecords.length,
        todaySeconds: todayStat ? (todayStat.practiceSeconds || 0) + (todayStat.readingSeconds || 0) : 0,
        bestAccuracy: records.reduce((best, r) => (r.totalBlanks > 0 ? Math.max(best, r.correctCount / r.totalBlanks) : best), 0),
        lastPracticeAt: records.reduce((last, r) => Math.max(last, r.timestamp), 0),
    };
}
exports.globalStats = globalStats;
/** 每日练习趋势（近 N 天：次数 + 正确率） */
function dailyTrend(days = 14) {
    const keys = (0, date_1.lastNDays)(days);
    const records = entities_1.recordStore.list();
    const stats = entities_1.studyStatStore.list();
    return keys.map((date) => {
        const dayRecords = records.filter((r) => (0, date_1.dateKey)(r.timestamp) === date);
        const blanks = dayRecords.reduce((s, r) => s + r.totalBlanks, 0);
        const correct = dayRecords.reduce((s, r) => s + r.correctCount, 0);
        const stat = stats.find((s) => s.date === date);
        return {
            date,
            label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
            count: dayRecords.length,
            accuracy: blanks > 0 ? correct / blanks : 0,
            seconds: stat ? (stat.practiceSeconds || 0) + (stat.readingSeconds || 0) : 0,
        };
    });
}
exports.dailyTrend = dailyTrend;
/** 学习日历（近 N 天：是否有学习行为） */
function calendar(days = 84) {
    const keys = (0, date_1.lastNDays)(days);
    const stats = new Map(entities_1.studyStatStore.list().map((s) => [s.date, s]));
    const records = entities_1.recordStore.list();
    const recordDays = new Set(records.map((r) => (0, date_1.dateKey)(r.timestamp)));
    return keys.map((date) => {
        const stat = stats.get(date);
        const seconds = stat ? (stat.practiceSeconds || 0) + (stat.readingSeconds || 0) : 0;
        return { date, active: seconds > 0 || recordDays.has(date), seconds };
    });
}
exports.calendar = calendar;
/** 弱点画像（错误类型占比） */
function weaknessProfile() {
    const records = entities_1.recordStore.list();
    const counter = { TYPO: 0, MISSING: 0, EXTRA: 0, WRONG_ORDER: 0 };
    for (const r of records)
        for (const m of r.mistakes)
            counter[m.errorType] = (counter[m.errorType] || 0) + 1;
    const total = Object.values(counter).reduce((s, v) => s + v, 0);
    const label = { TYPO: '错别字', MISSING: '漏字', EXTRA: '多填', WRONG_ORDER: '顺序错' };
    return Object.keys(counter).map((type) => ({
        type,
        label: label[type] || type,
        count: counter[type],
        ratio: total > 0 ? counter[type] / total : 0,
    }));
}
exports.weaknessProfile = weaknessProfile;
/** 模式对比 */
function modeComparison() {
    const records = entities_1.recordStore.list();
    const label = { SENTENCE: '句子挖空', WORD: '字词挖空', REVERSE: '反向默写' };
    const modes = ['SENTENCE', 'WORD', 'REVERSE'];
    return modes.map((mode) => {
        const list = records.filter((r) => r.mode === mode);
        const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
        const correct = list.reduce((s, r) => s + r.correctCount, 0);
        return { mode, label: label[mode], count: list.length, accuracy: blanks > 0 ? correct / blanks : 0 };
    });
}
exports.modeComparison = modeComparison;
/** 进步趋势：近 7 天 vs 更早（±5% 判定） */
function progressTrend() {
    const records = entities_1.recordStore.list();
    const since = (0, date_1.startOfDay)(Date.now() - 6 * date_1.MILLIS_PER_DAY);
    const recent = records.filter((r) => r.timestamp >= since);
    const earlier = records.filter((r) => r.timestamp < since);
    const acc = (list) => {
        const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
        const correct = list.reduce((s, r) => s + r.correctCount, 0);
        return blanks > 0 ? correct / blanks : 0;
    };
    const a = acc(recent);
    const b = acc(earlier);
    const delta = a - b;
    return { recent: a, earlier: b, delta, trend: delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat' };
}
exports.progressTrend = progressTrend;
/** 需加强的文章（正确率最低的前 3 篇，仅统计练习次数 ≥1 的文章） */
function weakestArticles(limit = 3) {
    const records = entities_1.recordStore.list();
    const byArticle = new Map();
    for (const r of records) {
        const list = byArticle.get(r.articleUuid) || [];
        list.push(r);
        byArticle.set(r.articleUuid, list);
    }
    const out = [];
    byArticle.forEach((list, articleUuid) => {
        const blanks = list.reduce((s, r) => s + r.totalBlanks, 0);
        const correct = list.reduce((s, r) => s + r.correctCount, 0);
        const article = entities_1.articleStore.find(articleUuid);
        out.push({
            articleUuid,
            title: article ? article.title : '(已删除)',
            accuracy: blanks > 0 ? correct / blanks : 0,
            count: list.length,
        });
    });
    return out.sort((a, b) => a.accuracy - b.accuracy).slice(0, limit);
}
exports.weakestArticles = weakestArticles;
/** 单篇统计 */
function articleStats(articleUuid) {
    // 走按文章索引（O(1)），避免每篇文章一次全量记录扫描
    const records = (0, entities_1.recordsOfArticle)(articleUuid);
    const blanks = records.reduce((s, r) => s + r.totalBlanks, 0);
    const correct = records.reduce((s, r) => s + r.correctCount, 0);
    const days = new Set(records.map((r) => (0, date_1.dateKey)(r.timestamp)));
    return {
        accuracy: blanks > 0 ? correct / blanks : 0,
        count: records.length,
        bestAccuracy: records.reduce((best, r) => (r.totalBlanks > 0 ? Math.max(best, r.correctCount / r.totalBlanks) : best), 0),
        lastAt: records.reduce((last, r) => Math.max(last, r.timestamp), 0),
        totalCorrect: correct,
        streak: days.size,
    };
}
exports.articleStats = articleStats;
/** 句子记忆概览 */
function sentenceMemory() {
    const states = (0, entities_1.allFsrs)().filter((s) => s.key.startsWith('s:'));
    const totalReviews = states.reduce((s, it) => s + (it.reviewCount || 0), 0);
    const lapses = states.reduce((s, it) => s + (it.lapses || 0), 0);
    const now = Date.now();
    const retentions = states.map((s) => fsrs_1.FsrsEngine.retentionRate(s, now));
    return {
        remembered: states.length,
        totalReviews,
        forgettingRate: totalReviews > 0 ? lapses / totalReviews : 0,
        avgRetention: retentions.length > 0 ? retentions.reduce((s, v) => s + v, 0) / retentions.length : 0,
        dueToday: states.filter((s) => s.due <= now).length,
    };
}
exports.sentenceMemory = sentenceMemory;
/** 即将遗忘（逾期 + 今天 + 3 天内，取前 N） */
function dueSoon(limit = 5) {
    const articles = entities_1.articleStore.list();
    if (articles.length === 0)
        return [];
    const records = entities_1.recordStore.list();
    const articleStates = new Map();
    for (const s of (0, entities_1.allFsrs)()) {
        if (!s.key.startsWith('s:'))
            articleStates.set(s.key, s);
    }
    // 使用用户所选复习模板（无 FSRS 状态时的间隔兜底；FSRS 存在时目标留存率已在启动时配置）
    const predictions = forgetting_1.ForgettingPredictor.predict(articles, records, (0, template_1.currentReviewTemplate)(), articleStates);
    return forgetting_1.ForgettingPredictor.dueSoon(predictions).slice(0, limit);
}
exports.dueSoon = dueSoon;
/** 成就（11 项） */
function achievements() {
    const stats = globalStats();
    return achievement_1.AchievementManager.evaluate(entities_1.recordStore.list(), stats.longestStreak, stats.streak);
}
exports.achievements = achievements;
/** 标签分布 */
function tagDistribution() {
    const articles = entities_1.articleStore.list();
    const counter = new Map();
    for (const a of articles) {
        for (const t of (0, entities_1.tagsOfArticle)(a.uuid))
            counter.set(t.name, (counter.get(t.name) || 0) + 1);
    }
    const out = [];
    for (const t of entities_1.tagStore.list()) {
        out.push({ name: t.name, color: t.color, count: counter.get(t.name) || 0 });
    }
    return out.sort((a, b) => b.count - a.count);
}
exports.tagDistribution = tagDistribution;
/** 阅读时长格式化（供 UI 直接展示） */
function formatStudy(seconds) {
    return (0, date_1.formatDuration)(seconds);
}
exports.formatStudy = formatStudy;
