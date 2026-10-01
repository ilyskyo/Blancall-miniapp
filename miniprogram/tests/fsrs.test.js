"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fsrs_1 = require("../core/algorithms/fsrs");
const DAY = 86400000;
const T0 = 1700000000000;
const INT_MAX = 2147483647;
/** 期望值由 Python 独立复刻 FSRS-6 公式生成（见报告说明） */
function approx(actual, expected, msg) {
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    strict_1.default.ok(Math.abs(actual - expected) <= tol, `${msg !== null && msg !== void 0 ? msg : ''} expected ${expected} got ${actual} (diff ${actual - expected})`);
}
function fresh() {
    return { difficulty: 0, stability: 0, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0 };
}
function state(over) {
    return { ...fresh(), ...over };
}
/** 与实现同口径复算 raw interval（requestRetention=0.9 时 I(S)≈S） */
function rawInterval(stability) {
    const w20 = fsrs_1.FsrsEngine.DEFAULT_PARAMS[20];
    const decay = -w20;
    const factor = Math.pow(0.9, 1 / decay) - 1;
    return stability / factor * (Math.pow(fsrs_1.FsrsEngine.DEFAULT_REQUEST_RETENTION, 1 / decay) - 1);
}
/** applyFuzz 的合法区间（>=2.5 天生效） */
function fuzzBounds(raw) {
    const ivl = Math.round(raw);
    return [Math.max(2, Math.round(ivl * 0.95 - 1)), Math.round(ivl * 1.05 + 1)];
}
(0, node_test_1.default)('DEFAULT_PARAMS 为 FSRS-6 官方 21 个权重（逐位一致）', () => {
    strict_1.default.deepEqual(fsrs_1.FsrsEngine.DEFAULT_PARAMS, [
        0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
        1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
        1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ]);
    strict_1.default.equal(fsrs_1.FsrsEngine.DEFAULT_REQUEST_RETENTION, 0.9);
    strict_1.default.equal(fsrs_1.Rating.AGAIN, 1);
    strict_1.default.equal(fsrs_1.Rating.HARD, 2);
    strict_1.default.equal(fsrs_1.Rating.GOOD, 3);
    strict_1.default.equal(fsrs_1.Rating.EASY, 4);
    strict_1.default.equal(fsrs_1.FsrsEngine.Rating.GOOD, fsrs_1.Rating.GOOD);
});
(0, node_test_1.default)('首次评级：初始难度/稳定性公式', () => {
    const s = fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0);
    approx(s.stability, 2.3065, 'initStability(GOOD)=w[2]');
    approx(s.difficulty, 2.118103970459015, 'initDifficulty(GOOD)');
    strict_1.default.equal(s.reviewCount, 1);
    strict_1.default.equal(s.lapses, 0);
    strict_1.default.equal(s.lastReview, T0);
    // raw=2.3065 < 2.5 → 无 fuzz，round(2.3065)=2
    strict_1.default.equal(s.due, T0 + 2 * DAY);
    const again = fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.AGAIN, T0);
    approx(again.stability, 0.212, 'initStability(AGAIN)=w[0]');
    approx(again.difficulty, 6.4133, 'initDifficulty(AGAIN)');
    // raw=0.212 → round=0 → coerceIn(1, MAX)=1
    strict_1.default.equal(again.due, T0 + DAY);
    strict_1.default.equal(again.lapses, 1);
});
(0, node_test_1.default)('固定评级序列 GOOD/GOOD/AGAIN/HARD/EASY 的 difficulty/stability 数值', () => {
    const s1 = fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0);
    const s2 = fsrs_1.FsrsEngine.review(s1, fsrs_1.Rating.GOOD, T0 + 3 * DAY);
    const s3 = fsrs_1.FsrsEngine.review(s2, fsrs_1.Rating.AGAIN, T0 + 5 * DAY);
    const s4 = fsrs_1.FsrsEngine.review(s3, fsrs_1.Rating.HARD, T0 + 6 * DAY);
    const s5 = fsrs_1.FsrsEngine.review(s4, fsrs_1.Rating.EASY, T0 + 10 * DAY);
    approx(s2.difficulty, 2.1169858664885557, 's2.difficulty');
    approx(s2.stability, 13.826903694354572, 's2.stability');
    approx(s3.difficulty, 7.399906858810896, 's3.difficulty');
    approx(s3.stability, 1.511297407250357, 's3.stability');
    approx(s4.difficulty, 8.264937008538293, 's4.difficulty');
    approx(s4.stability, 2.719760235883209, 's4.stability');
    approx(s5.difficulty, 7.676159810727193, 's5.difficulty');
    approx(s5.stability, 10.985808856648383, 's5.stability');
    strict_1.default.deepEqual([s1.reviewCount, s2.reviewCount, s3.reviewCount, s4.reviewCount, s5.reviewCount], [1, 2, 3, 4, 5]);
    strict_1.default.deepEqual([s1.lapses, s2.lapses, s3.lapses, s4.lapses, s5.lapses], [0, 0, 1, 1, 1]);
});
(0, node_test_1.default)('间隔：raw<2.5 无 fuzz（确定性），raw>=2.5 落在 ±5%（实现区间）内', () => {
    // raw < 2.5：50 次结果完全一致（2.3065 → 2 天）
    for (let i = 0; i < 50; i++) {
        strict_1.default.equal(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0).due, T0 + 2 * DAY);
    }
    // AGAIN s3 raw=1.511297407250357 < 2.5 → round=2
    const s2 = fsrs_1.FsrsEngine.review(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0), fsrs_1.Rating.GOOD, T0 + 3 * DAY);
    const s3 = fsrs_1.FsrsEngine.review(s2, fsrs_1.Rating.AGAIN, T0 + 5 * DAY);
    strict_1.default.equal(s3.due - (T0 + 5 * DAY), 2 * DAY);
    // raw >= 2.5：HARD（raw≈2.7198）与 EASY（raw≈10.9858）多次采样均落在实现区间
    const [loH, hiH] = fuzzBounds(rawInterval(2.719760235883209));
    const [loE, hiE] = fuzzBounds(rawInterval(10.985808856648383));
    const seenH = new Set();
    const seenE = new Set();
    for (let i = 0; i < 200; i++) {
        const a = fsrs_1.FsrsEngine.review(state({ difficulty: 7.399906858810896, stability: 1.511297407250357, due: T0 + 10 * DAY, lastReview: T0 + 5 * DAY, reviewCount: 3, lapses: 1, lastRating: 1 }), fsrs_1.Rating.HARD, T0 + 6 * DAY);
        const dH = (a.due - (T0 + 6 * DAY)) / DAY;
        approx(a.stability, 2.719760235883209, 'HARD stability');
        strict_1.default.ok(dH >= loH && dH <= hiH, `HARD fuzz ${dH} not in [${loH},${hiH}]`);
        seenH.add(dH);
        const b = fsrs_1.FsrsEngine.review(state({ difficulty: 8.264937008538293, stability: 2.719760235883209, due: T0 + 11 * DAY, lastReview: T0 + 6 * DAY, reviewCount: 4, lapses: 1, lastRating: 2 }), fsrs_1.Rating.EASY, T0 + 10 * DAY);
        const dE = (b.due - (T0 + 10 * DAY)) / DAY;
        approx(b.stability, 10.985808856648383, 'EASY stability');
        strict_1.default.ok(dE >= loE && dE <= hiE, `EASY fuzz ${dE} not in [${loE},${hiE}]`);
        seenE.add(dE);
    }
    // 随机确实生效（区间内出现多个取值）
    strict_1.default.ok(seenH.size > 1, 'HARD fuzz 应产生随机分布');
    strict_1.default.ok(seenE.size > 1, 'EASY fuzz 应产生随机分布');
});
(0, node_test_1.default)('间隔上下限：MIN_STABILITY 与 MAX_INTERVAL_DAYS=36500', () => {
    // 极大稳定性 → clamp 到 36500 天
    const big = fsrs_1.FsrsEngine.review(state({ difficulty: 5, stability: 1e9, due: T0 - DAY, lastReview: T0 - 100 * DAY, reviewCount: 5, lapses: 0, lastRating: 3 }), fsrs_1.Rating.GOOD, T0);
    strict_1.default.equal(big.due - T0, 36500 * DAY);
    // 遗忘分支下限：稳定性不低 MIN_STABILITY，间隔至少 1 天
    const low = fsrs_1.FsrsEngine.review(state({ difficulty: 9, stability: 0.2, due: T0 - DAY, lastReview: T0 - DAY, reviewCount: 2, lapses: 1, lastRating: 1 }), fsrs_1.Rating.AGAIN, T0);
    strict_1.default.ok(low.stability >= 0.1);
    strict_1.default.ok(low.due - T0 >= DAY);
});
(0, node_test_1.default)('同日复习：走 FSRS-6 同日公式（不推进间隔）', () => {
    // 同一日历日、未到期 → S\' = S·e^(w17(G-3+w18))·S^(-w19)
    const base = state({ difficulty: 5, stability: 10, due: T0 + 30 * DAY, lastReview: T0, reviewCount: 3, lapses: 0, lastRating: 3 });
    const s = fsrs_1.FsrsEngine.review(base, fsrs_1.Rating.GOOD, T0 + 3600000);
    approx(s.stability, 9.029987596817193, 'same-day stability');
    approx(s.difficulty, 4.996, 'same-day difficulty');
    strict_1.default.equal(s.reviewCount, 4);
});
(0, node_test_1.default)('retentionRate：Δt=0 → 1，Δt=S → 0.9；stability<=0 → 0', () => {
    const st = state({ difficulty: 2.118, stability: 2.3065, due: 0, lastReview: T0, reviewCount: 1, lapses: 0, lastRating: 3 });
    strict_1.default.equal(fsrs_1.FsrsEngine.retentionRate(st, T0), 1);
    approx(fsrs_1.FsrsEngine.retentionRate(st, T0 + 2.3065 * DAY), 0.9, 'R(Δt=S)');
    approx(fsrs_1.FsrsEngine.retentionRate(st, T0 + DAY), 0.9468474993825461, 'R(Δt=1), S=2.3065');
    strict_1.default.equal(fsrs_1.FsrsEngine.retentionRate(fresh(), T0), 0);
});
(0, node_test_1.default)('daysUntilDue / isDue 边界', () => {
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(fresh(), T0), INT_MAX);
    strict_1.default.equal(fsrs_1.FsrsEngine.isDue(fresh(), T0 + 999 * DAY), false);
    const st = state({ difficulty: 5, stability: 1, due: T0, lastReview: T0 - DAY, reviewCount: 1, lapses: 0, lastRating: 3 });
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0), 0, '恰好到期 → 0');
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0 + 1), 0, '逾期不足 1 天 → 0（ceil 归一）');
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0 - 1), 1, '距到期 1ms → 1');
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0 - DAY), 1, '整整 1 天 → 1');
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0 - 2 * DAY), 2);
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0 + DAY), -1, '逾期 1 天 → -1');
    strict_1.default.equal(fsrs_1.FsrsEngine.daysUntilDue(st, T0 + DAY + 1), -1, '逾期 1 天多 → -1');
    strict_1.default.equal(fsrs_1.FsrsEngine.isDue(st, T0 - 1), false);
    strict_1.default.equal(fsrs_1.FsrsEngine.isDue(st, T0), true);
    strict_1.default.equal(fsrs_1.FsrsEngine.isDue(st, T0 + 1), true);
});
(0, node_test_1.default)('评级映射：正确率与相似度阈值', () => {
    strict_1.default.equal(fsrs_1.FsrsEngine.ratingFromAccuracy(0.39), fsrs_1.Rating.AGAIN);
    strict_1.default.equal(fsrs_1.FsrsEngine.ratingFromAccuracy(0.4), fsrs_1.Rating.HARD);
    strict_1.default.equal(fsrs_1.FsrsEngine.ratingFromAccuracy(0.69), fsrs_1.Rating.HARD);
    strict_1.default.equal(fsrs_1.FsrsEngine.ratingFromAccuracy(0.7), fsrs_1.Rating.GOOD);
    strict_1.default.equal(fsrs_1.FsrsEngine.ratingFromAccuracy(0.89), fsrs_1.Rating.GOOD);
    strict_1.default.equal(fsrs_1.FsrsEngine.ratingFromAccuracy(0.9), fsrs_1.Rating.EASY);
    strict_1.default.equal(fsrs_1.FsrsEngine.gradeFromSimilarity(0.59), fsrs_1.Rating.AGAIN);
    strict_1.default.equal(fsrs_1.FsrsEngine.gradeFromSimilarity(0.6), fsrs_1.Rating.HARD);
    strict_1.default.equal(fsrs_1.FsrsEngine.gradeFromSimilarity(0.84), fsrs_1.Rating.HARD);
    strict_1.default.equal(fsrs_1.FsrsEngine.gradeFromSimilarity(0.85), fsrs_1.Rating.GOOD);
    strict_1.default.equal(fsrs_1.FsrsEngine.gradeFromSimilarity(0.96), fsrs_1.Rating.GOOD);
    strict_1.default.equal(fsrs_1.FsrsEngine.gradeFromSimilarity(0.97), fsrs_1.Rating.EASY);
});
(0, node_test_1.default)('retentionForTemplate：sprint/deep/其他', () => {
    strict_1.default.equal(fsrs_1.FsrsEngine.retentionForTemplate('sprint'), 0.85);
    strict_1.default.equal(fsrs_1.FsrsEngine.retentionForTemplate('deep'), 0.95);
    strict_1.default.equal(fsrs_1.FsrsEngine.retentionForTemplate('standard'), 0.9);
    strict_1.default.equal(fsrs_1.FsrsEngine.retentionForTemplate('unknown'), 0.9);
});
(0, node_test_1.default)('configure：合法参数生效并 clamp retention，非法参数忽略', () => {
    const w = fsrs_1.FsrsEngine.DEFAULT_PARAMS.slice();
    try {
        // 非法参数（长度不是 21）被忽略 → 仍用默认 0.9（RAW=S → 2 天）
        fsrs_1.FsrsEngine.configure([1, 2, 3], 0.5);
        strict_1.default.equal(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0).due, T0 + 2 * DAY, '非法参数应被忽略');
        // retention 上界 clamp 到 0.99：目标留存率越高 → 间隔越短
        fsrs_1.FsrsEngine.configure(w, 5);
        strict_1.default.equal(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0).due, T0 + DAY, 'retention clamp 到 0.99');
        // retention 下界 clamp 到 0.01：目标留存率极低 → 间隔拉到最大 36500 天
        fsrs_1.FsrsEngine.configure(w, 0.0001);
        strict_1.default.equal(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0).due, T0 + 36500 * DAY, 'retention clamp 到 0.01');
        // w[20] <= 0 视为非法，忽略
        const bad = w.slice();
        bad[20] = 0;
        fsrs_1.FsrsEngine.configure(bad, 0.5);
        strict_1.default.equal(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0).due, T0 + 36500 * DAY, '非法 w[20] 被忽略（沿用上次有效配置）');
    }
    finally {
        fsrs_1.FsrsEngine.configure(fsrs_1.FsrsEngine.DEFAULT_PARAMS.slice(), fsrs_1.FsrsEngine.DEFAULT_REQUEST_RETENTION);
    }
    strict_1.default.equal(fsrs_1.FsrsEngine.review(fresh(), fsrs_1.Rating.GOOD, T0).due, T0 + 2 * DAY, '重置回默认');
});
