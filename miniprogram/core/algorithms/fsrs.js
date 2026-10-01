"use strict";
/**
 * FSRS-6 间隔重复算法（移植自 Android 端 `algorithm/FSRS.kt`，逐行对齐）
 *
 * 相比旧混合实现（v4 遗忘曲线 + v4.5 参数），FSRS-6 的核心差异：
 * - 遗忘曲线 decay 可训练：R(t,S) = (1 + factor·t/S)^(-w20)，factor = 0.9^(-1/w20) - 1
 * - 同日复习稳定性带收敛项：S' = S·e^(w17(G-3+w18))·S^(-w19)，S 越大增长越慢
 *
 * ## 公式依据（官方 awesome-fsrs wiki The-Algorithm）
 * - 初始稳定性：S0(G) = w[G-1]
 * - 初始难度：D0(G) = w4 - e^(w5·(r-1)) + 1，clamp [1, 10]
 * - 间隔：I(S) = S/factor · (R^(1/decay) - 1)，factor = 0.9^(-1/w20) - 1，decay = -w20
 * - 难度更新：ΔD = -w6·(r-3)·(10-D)/9，均值回归到 D0(EASY)
 * - 成功复习稳定性：S' = S·(1 + e^w8·(11-D)·S^(-w9)·(e^((1-r)·w10)-1)·hardPenalty·easyBonus)
 * - 遗忘稳定性：S' = min(w11·D^(-w12)·((S+1)^w13-1)·e^((1-r)·w14), S/e^(w17·w18))
 * - 同日复习：S' = S·e^(w17·(G-3+w18))·S^(-w19)
 * - 间隔扰动（fuzz）：±5% 随机化，避免同日复习堆积
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FsrsEngine = exports.Rating = void 0;
/** 一天的毫秒数 */
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
/** 最小稳定性（天） */
const MIN_STABILITY = 0.1;
/** 最大间隔（天） */
const MAX_INTERVAL_DAYS = 36500;
/** Kotlin Int.MAX_VALUE（daysUntilDue 未开始时的返回值） */
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;
/** 评级（与官方 Rating 一致：1=忘记 2=困难 3=良好 4=轻松） */
var Rating;
(function (Rating) {
    Rating[Rating["AGAIN"] = 1] = "AGAIN";
    Rating[Rating["HARD"] = 2] = "HARD";
    Rating[Rating["GOOD"] = 3] = "GOOD";
    Rating[Rating["EASY"] = 4] = "EASY";
})(Rating || (exports.Rating = Rating = {}));
/** Kotlin `Double.toInt()`：向零截断，越界饱和到 Int 范围（-0 归一为 0） */
function kotlinToInt(x) {
    if (Number.isNaN(x))
        return 0;
    if (x >= INT_MAX)
        return INT_MAX;
    if (x <= INT_MIN)
        return INT_MIN;
    const t = Math.trunc(x);
    return t === 0 ? 0 : t;
}
/** Kotlin `Double.roundToInt()`（= java.lang.Math.round，四舍五入，.5 向 +∞） */
function roundToInt(x) {
    if (Number.isNaN(x))
        return 0;
    if (x >= INT_MAX)
        return INT_MAX;
    if (x <= INT_MIN)
        return INT_MIN;
    const t = Math.round(x);
    return t === 0 ? 0 : t;
}
/** Kotlin `coerceIn` */
function coerceIn(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
/** FSRS-6 官方默认参数（Anki 开源默认权重 w[0..20]，21 个，逐位照抄） */
const DEFAULT_PARAMS = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
/** 目标留存率（Anki 默认 90%） */
const DEFAULT_REQUEST_RETENTION = 0.9;
// ── 可变模块状态（对应 Kotlin object 的 @Volatile 字段）──
let params = DEFAULT_PARAMS;
let requestRetention = DEFAULT_REQUEST_RETENTION;
/** decay = -params[20] */
function decay() {
    return -params[20];
}
/** factor = 0.9^(1/decay) - 1 */
function factor() {
    return Math.pow(0.9, 1.0 / decay()) - 1;
}
/** 遗忘曲线 R = (1 + factor·t/S)^(-w20) */
function forgettingCurve(elapsedDays, stability) {
    // 幂律曲线守卫：elapsed<=0 或基≤0 时直接返回边界值，防止 pow NaN
    if (elapsedDays <= 0.0)
        return 1.0;
    if (stability <= 0.0)
        return 0.0;
    return Math.pow(1 + factor() * elapsedDays / stability, -params[20]);
}
/** 初始难度 D0(G) = w4 - e^(w5·(G-1)) + 1，clamp [1, 10] */
function initDifficulty(rating) {
    const raw = params[4] - Math.exp(params[5] * (rating - 1)) + 1;
    return coerceIn(raw, 1.0, 10.0);
}
/** 初始稳定性 S0(G) = w[G-1]，下限 MIN_STABILITY */
function initStability(rating) {
    // 注意：官方为 coerceAtLeast(MIN_STABILITY)；部分移植版误写为 coerceAtMost 会压坏初始状态
    return Math.max(params[rating - 1], MIN_STABILITY);
}
/** 间隔扰动：仅对 >= 2.5 天的间隔生效，±5% 随机化防堆积 */
function applyFuzz(interval) {
    if (interval < 2.5)
        return interval;
    const ivl = roundToInt(interval);
    const minIvl = Math.max(2, roundToInt(ivl * 0.95 - 1));
    const maxIvl = roundToInt(ivl * 1.05 + 1);
    return Math.floor(Math.random() * (maxIvl - minIvl + 1) + minIvl);
}
/** 间隔（天）：I(S) = S/factor · (R^(1/decay) - 1)，fuzz 后 roundToInt 并 clamp [1, MAX] */
function nextInterval(stability) {
    const rawInterval = stability / factor() * (Math.pow(requestRetention, 1.0 / decay()) - 1);
    const fuzzed = applyFuzz(rawInterval);
    return coerceIn(roundToInt(fuzzed), 1, MAX_INTERVAL_DAYS);
}
/** 难度更新：ΔD = -w6·(r-3)·(10-D)/9，向 D0(EASY) 均值回归 */
function nextDifficulty(currentD, rating) {
    const deltaD = -params[6] * (rating - 3);
    const damped = deltaD * (10 - currentD) / 9;
    const nextD = currentD + damped;
    const reverted = params[7] * initDifficulty(Rating.EASY) + (1 - params[7]) * nextD;
    return coerceIn(reverted, 1.0, 10.0);
}
/** 成功复习后的稳定性增长 */
function nextRecallStability(d, s, r, rating) {
    const hardPenalty = rating === Rating.HARD ? params[15] : 1.0;
    const easyBonus = rating === Rating.EASY ? params[16] : 1.0;
    const grow = Math.exp(params[8]) * (11 - d) * Math.pow(s, -params[9]) *
        (Math.exp((1 - r) * params[10]) - 1) * hardPenalty * easyBonus;
    return Math.max(s * (1 + grow), MIN_STABILITY);
}
/** 遗忘（AGAIN）后的稳定性 */
function nextForgetStability(d, s, r) {
    const sMin = s / Math.exp(params[17] * params[18]);
    const result = params[11] * Math.pow(d, -params[12]) * (Math.pow(s + 1, params[13]) - 1) *
        Math.exp((1 - r) * params[14]);
    return Math.max(Math.min(result, sMin), MIN_STABILITY);
}
/** 本地日历日（用于「同日复习」判定） */
function localDayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
exports.FsrsEngine = {
    /** 评级枚举（对应 Kotlin 的 FsrsEngine.Rating 嵌套枚举） */
    Rating,
    /** FSRS-6 官方默认参数（21 个权重） */
    DEFAULT_PARAMS,
    /** 目标留存率（Anki 默认 90%） */
    DEFAULT_REQUEST_RETENTION,
    /**
     * 配置算法参数（默认即官方 FSRS-6 参数）。
     * 仅在 21 个有限权重且 w[20] > 0 时生效；retention clamp 到 [0.01, 0.99]。
     */
    configure(w, retention) {
        if (w.length === 21 && w.every((it) => Number.isFinite(it)) && w[20] > 0) {
            params = w;
            requestRetention = coerceIn(retention, 0.01, 0.99);
        }
    },
    /** 正确率 → 评级映射（保留兼容旧路径） */
    ratingFromAccuracy(accuracy) {
        if (accuracy < 0.4)
            return Rating.AGAIN;
        if (accuracy < 0.7)
            return Rating.HARD;
        if (accuracy < 0.9)
            return Rating.GOOD;
        return Rating.EASY;
    },
    /**
     * 默写文本相似度 → 评级映射（逐字复现产品语义）：
     * - <0.60：核心内容有误 → AGAIN
     * - <0.85：存在字词错误 → HARD
     * - <0.97：仅标点/归一化级差异 → GOOD
     * - ≥0.97：逐字准确 → EASY
     */
    gradeFromSimilarity(similarity) {
        if (similarity < 0.6)
            return Rating.AGAIN;
        if (similarity < 0.85)
            return Rating.HARD;
        if (similarity < 0.97)
            return Rating.GOOD;
        return Rating.EASY;
    },
    /**
     * 复习模板 → 目标留存率映射（设置页「复习频率」控制 FSRS 复习强度）：
     * - 冲刺备考：85%（间隔短，练得勤）
     * - 标准记忆：90%（Anki 默认，均衡）
     * - 深度长期：95%（间隔长，要求高留存）
     */
    retentionForTemplate(templateId) {
        if (templateId === 'sprint')
            return 0.85;
        if (templateId === 'deep')
            return 0.95;
        return DEFAULT_REQUEST_RETENTION; // standard 及未知值
    },
    /** 当前记忆留存率 R(t) = (1 + factor·t/S)^(-w20)，0-1（FSRS-6 幂律曲线） */
    retentionRate(state, now = Date.now()) {
        if (state.stability <= 0.0)
            return 0.0;
        const elapsed = (now - state.lastReview) / MILLIS_PER_DAY;
        return forgettingCurve(elapsed, state.stability);
    },
    /** 距复习到期天数：负数=已逾期，0=今天到期，正数=未来 */
    daysUntilDue(state, now = Date.now()) {
        if (state.reviewCount === 0)
            return INT_MAX;
        const diffMs = state.due - now;
        return kotlinToInt(Math.ceil(diffMs / MILLIS_PER_DAY));
    },
    /** 该文章是否已到复习时间 */
    isDue(state, now = Date.now()) {
        return state.reviewCount > 0 && now >= state.due;
    },
    /**
     * 练习后更新记忆状态（核心入口）。
     *
     * @param state 现有状态（首次练习传新 CardState()）
     * @param rating 本次练习评级（由正确率映射）
     * @return 更新后的新状态（调用方负责持久化）
     */
    review(state, rating, now = Date.now()) {
        const isNew = state.reviewCount === 0 || state.stability <= 0.0;
        let newDifficulty;
        let newStability;
        if (isNew) {
            newDifficulty = initDifficulty(rating);
            newStability = initStability(rating);
        }
        else {
            const elapsedDays = (now - state.lastReview) / MILLIS_PER_DAY;
            // 同日复习（同一日历日且未到期）：稳定性走 FSRS-6 同日公式，不推进间隔
            const sameDay = now >= state.lastReview && localDayKey(now) === localDayKey(state.lastReview);
            if (sameDay && now < state.due) {
                const newS = state.stability *
                    Math.exp(params[17] * (rating - 3 + params[18])) *
                    Math.pow(state.stability, -params[19]);
                newDifficulty = nextDifficulty(state.difficulty, rating);
                newStability = Math.max(newS, MIN_STABILITY);
            }
            else {
                const retrievability = forgettingCurve(elapsedDays, state.stability);
                newDifficulty = nextDifficulty(state.difficulty, rating);
                newStability = rating === Rating.AGAIN
                    ? nextForgetStability(state.difficulty, state.stability, retrievability)
                    : nextRecallStability(state.difficulty, state.stability, retrievability, rating);
            }
        }
        const intervalDays = nextInterval(newStability);
        return {
            difficulty: newDifficulty,
            stability: newStability,
            due: now + intervalDays * MILLIS_PER_DAY,
            lastReview: now,
            reviewCount: state.reviewCount + 1,
            lapses: state.lapses + (rating === Rating.AGAIN ? 1 : 0),
            // Kotlin review() 未赋值 lastRating（默认空串）；此处落盘类型为数字，取本次评级
            lastRating: rating,
        };
    },
};
