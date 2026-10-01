"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const forgetting_1 = require("../core/algorithms/forgetting");
const ebbinghaus_1 = require("../core/algorithms/ebbinghaus");
const DAY = 86400000;
const N = 1700000000000;
const INT_MAX = 2147483647;
function article(uuid) {
    return { uuid, title: `标题-${uuid}`, content: '', author: '', autoIndent: false, createdAt: 0, updatedAt: 0 };
}
function rec(articleUuid, timestamp, correctCount, totalBlanks) {
    return {
        uuid: `${articleUuid}-${timestamp}`, articleUuid, mode: 'SENTENCE',
        totalBlanks, correctCount, mistakes: [], timestamp, duration: 0,
        similarity: 0, rating: 0, weakHints: 0, strongHints: 0,
        answeredSentenceStarts: [], mistakeSentenceIndices: [],
    };
}
function fstate(over) {
    return { difficulty: 5, stability: 5, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0, ...over };
}
function approx(actual, expected, msg) {
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    strict_1.default.ok(Math.abs(actual - expected) <= tol, `${msg !== null && msg !== void 0 ? msg : ''} expected ${expected} got ${actual}`);
}
function run(articles, records, fsrsStates = new Map()) {
    return forgetting_1.ForgettingPredictor.predict(articles, records, ebbinghaus_1.ReviewTemplate.STANDARD, fsrsStates, N);
}
(0, node_test_1.default)('predict：无文章返回空数组', () => {
    strict_1.default.deepEqual(run([], []), []);
});
(0, node_test_1.default)('加权正确率：少于 5 次仍单调递减；超过 5 次只用最近 5 次', () => {
    // WA：3 条记录（最旧→最新 1.0/0.6/0.8）→ 权重 3,2,1（最近权重最大）
    const wa = run([article('WA')], [rec('WA', N - 3 * DAY, 10, 10), rec('WA', N - 2 * DAY, 6, 10), rec('WA', N - DAY, 8, 10)])[0];
    approx(wa.lastAccuracy, 0.7666666666666667, 'WA 3 次加权');
    // N6：6 条记录，仅最近 5 次参与
    const n6recs = [];
    const accs = [1.0, 1.0, 0.9, 0.8, 0.7, 0.6];
    for (let i = 0; i < 6; i++)
        n6recs.push(rec('N6', N - (5 - i) * DAY, Math.round(accs[i] * 10), 10));
    const n6 = run([article('N6')], n6recs)[0];
    approx(n6.lastAccuracy, 0.7333333333333333, 'N6 6 次仅取最近 5');
});
(0, node_test_1.default)('记忆强度：S1=1，S*=S×(1+0.5·acc)，acc<0.3 不增长', () => {
    const wa = run([article('WA')], [rec('WA', N - 3 * DAY, 10, 10), rec('WA', N - 2 * DAY, 6, 10), rec('WA', N - DAY, 8, 10)])[0];
    approx(wa.memoryStrength, 1.8199999999999998, 'WA 记忆强度');
    // 第二条 acc=0.2 < 0.3 → 不增长（S 保持 1）
    const low = run([article('L')], [rec('L', N - 2 * DAY, 10, 10), rec('L', N - DAY, 2, 10)])[0];
    approx(low.memoryStrength, 1, 'acc<0.3 不增长');
    const n6recs = [];
    const accs = [1.0, 1.0, 0.9, 0.8, 0.7, 0.6];
    for (let i = 0; i < 6; i++)
        n6recs.push(rec('N6', N - (5 - i) * DAY, Math.round(accs[i] * 10), 10));
    const n6 = run([article('N6')], n6recs)[0];
    approx(n6.memoryStrength, 5.3439749999999995, 'N6 记忆强度');
});
(0, node_test_1.default)('紧急度分类：NEW / OVERDUE / TODAY / SOON / LATER / MASTERED', () => {
    const recs = [
        rec('B', N - 10 * DAY, 8, 10), // 1 次，应复习 = N-9d → OVERDUE(-9)
        rec('D', N - DAY, 10, 10), // 应复习 = N → TODAY(0)
        rec('C', N - DAY / 2, 10, 10), // 应复习 = N+0.5d → SOON(1)
        rec('E', N - 2.05 * DAY, 10, 10), // LATER（3 次，应复习 = N+3.95d）
        rec('E', N - 1.05 * DAY, 10, 10),
        rec('E', N - 0.05 * DAY, 10, 10),
    ];
    for (let i = 0; i < 6; i++)
        recs.push(rec('F', N - (5 - i) * DAY, 10, 10)); // 6 天 → MASTERED
    const fsrsStates = new Map([
        ['G', fstate({ reviewCount: 3, due: N + 2 * DAY, stability: 5, lastReview: N - 3 * DAY })],
    ]);
    const byId = new Map(run([article('A'), article('B'), article('C'), article('D'), article('E'), article('F'), article('G')], recs, fsrsStates).map((p) => [p.articleId, p]));
    const a = byId.get('A');
    strict_1.default.equal(a.urgency, forgetting_1.Urgency.NEW);
    strict_1.default.equal(a.daysLeft, INT_MAX);
    strict_1.default.equal(a.reviewDate, 0);
    strict_1.default.equal(a.practiceCount, 0);
    strict_1.default.equal(a.lastAccuracy, 0);
    strict_1.default.equal(a.retentionRate, 0);
    strict_1.default.equal(a.memoryStrength, 0);
    strict_1.default.deepEqual(a.decayCurve, []);
    const b = byId.get('B');
    strict_1.default.equal(b.urgency, forgetting_1.Urgency.OVERDUE);
    strict_1.default.equal(b.daysLeft, -9);
    approx(b.lastAccuracy, 0.8);
    approx(b.memoryStrength, 1);
    approx(b.retentionRate, 4.5399929762484854e-05, 'B 留存率');
    const d = byId.get('D');
    strict_1.default.equal(d.urgency, forgetting_1.Urgency.TODAY);
    strict_1.default.equal(d.daysLeft, 0);
    approx(d.retentionRate, 0.36787944117144233, 'D 留存率');
    const c = byId.get('C');
    strict_1.default.equal(c.urgency, forgetting_1.Urgency.SOON);
    strict_1.default.equal(c.daysLeft, 1);
    approx(c.retentionRate, 0.6065306597126334, 'C 留存率');
    const e = byId.get('E');
    strict_1.default.equal(e.urgency, forgetting_1.Urgency.LATER);
    strict_1.default.equal(e.daysLeft, 4);
    strict_1.default.equal(e.practiceCount, 3);
    approx(e.memoryStrength, 2.25, 'E 记忆强度');
    approx(e.retentionRate, 0.9780228724846005, 'E 留存率');
    const f = byId.get('F');
    strict_1.default.equal(f.urgency, forgetting_1.Urgency.MASTERED);
    strict_1.default.equal(f.daysLeft, INT_MAX);
    strict_1.default.equal(f.reviewDate, 0);
    strict_1.default.equal(f.practiceCount, 6);
    approx(f.memoryStrength, 7.59375, 'F 记忆强度');
    strict_1.default.equal(f.decayCurve.length, 31);
    // FSRS 分支：daysLeft 由 due 决定，memoryStrength = stability
    const g = byId.get('G');
    strict_1.default.equal(g.urgency, forgetting_1.Urgency.SOON);
    strict_1.default.equal(g.daysLeft, 2);
    strict_1.default.equal(g.practiceCount, 3);
    strict_1.default.equal(g.memoryStrength, 5);
    approx(g.retentionRate, 0.9311509409583194, 'G FSRS 留存率');
    strict_1.default.equal(g.decayCurve.length, 31);
    strict_1.default.equal(g.reviewDate, N + 2 * DAY);
});
(0, node_test_1.default)('衰减曲线：模板分支 31 点（index0=当前，逐日实时估算）', () => {
    const wa = run([article('WA')], [rec('WA', N - 3 * DAY, 10, 10), rec('WA', N - 2 * DAY, 6, 10), rec('WA', N - DAY, 8, 10)])[0];
    strict_1.default.equal(wa.decayCurve.length, 31);
    approx(wa.decayCurve[0], 0.5772669028761512, 'decayCurve[0]');
    approx(wa.decayCurve[30], 4.0056814304767635e-08, 'decayCurve[30]');
    // 单调递减
    for (let i = 1; i < wa.decayCurve.length; i++) {
        strict_1.default.ok(wa.decayCurve[i] < wa.decayCurve[i - 1], `曲线应单调递减 @${i}`);
    }
});
(0, node_test_1.default)('predict 排序：按 urgency.ordinal 升序，同级按 reviewDate 升序', () => {
    const articles = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(article);
    const recs = [
        rec('B', N - 10 * DAY, 8, 10),
        rec('D', N - DAY, 10, 10),
        rec('C', N - DAY / 2, 10, 10),
        rec('H', N - 0.2 * DAY, 10, 10),
        rec('I', N - 0.1 * DAY, 10, 10),
        rec('J', N - 0.05 * DAY, 10, 10),
        rec('E', N - 2.05 * DAY, 10, 10),
        rec('E', N - 1.05 * DAY, 10, 10),
        rec('E', N - 0.05 * DAY, 10, 10),
    ];
    for (let i = 0; i < 6; i++)
        recs.push(rec('F', N - (5 - i) * DAY, 10, 10));
    const fsrsStates = new Map([['G', fstate({ reviewCount: 3, due: N + 2 * DAY, stability: 5, lastReview: N - 3 * DAY })]]);
    const preds = run(articles, recs, fsrsStates);
    strict_1.default.deepEqual(preds.map((p) => p.articleId), ['B', 'D', 'C', 'H', 'I', 'J', 'G', 'E', 'A', 'F']);
    // 验证排序键本身
    for (let i = 1; i < preds.length; i++) {
        const prev = preds[i - 1];
        const cur = preds[i];
        strict_1.default.ok(prev.urgency < cur.urgency || (prev.urgency === cur.urgency && prev.reviewDate <= cur.reviewDate), `排序错误 @${i}: ${prev.articleId}(${prev.urgency},${prev.reviewDate}) → ${cur.articleId}(${cur.urgency},${cur.reviewDate})`);
    }
});
(0, node_test_1.default)('dueSoon：过滤 逾期+今天+3 天内，调用方再取前 5', () => {
    const articles = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(article);
    const recs = [
        rec('B', N - 10 * DAY, 8, 10),
        rec('D', N - DAY, 10, 10),
        rec('C', N - DAY / 2, 10, 10),
        rec('H', N - 0.2 * DAY, 10, 10),
        rec('I', N - 0.1 * DAY, 10, 10),
        rec('J', N - 0.05 * DAY, 10, 10),
        rec('E', N - 2.05 * DAY, 10, 10),
        rec('E', N - 1.05 * DAY, 10, 10),
        rec('E', N - 0.05 * DAY, 10, 10),
    ];
    for (let i = 0; i < 6; i++)
        recs.push(rec('F', N - (5 - i) * DAY, 10, 10));
    const fsrsStates = new Map([['G', fstate({ reviewCount: 3, due: N + 2 * DAY, stability: 5, lastReview: N - 3 * DAY })]]);
    const preds = run(articles, recs, fsrsStates);
    const due = forgetting_1.ForgettingPredictor.dueSoon(preds);
    strict_1.default.deepEqual(due.map((p) => p.articleId), ['B', 'D', 'C', 'H', 'I', 'J', 'G']);
    strict_1.default.ok(due.every((p) => p.urgency === forgetting_1.Urgency.OVERDUE || p.urgency === forgetting_1.Urgency.TODAY || p.urgency === forgetting_1.Urgency.SOON));
    // 首页卡片口径：调用方取前 5（OverviewScreen 中 dueSoon(predictions).take(5)）
    strict_1.default.deepEqual(due.slice(0, 5).map((p) => p.articleId), ['B', 'D', 'C', 'H', 'I']);
});
