"use strict";
/**
 * 艾宾浩斯遗忘曲线复习调度器（移植自 Android 端 `algorithm/EbbinghausScheduler.kt`，逐行对齐）
 * 支持自定义模板 + 自适应微调。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EbbinghausScheduler = exports.ReviewTemplate = void 0;
/** 一天的毫秒数，用于剩余天数计算 */
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
/** Kotlin `Double.toInt()`：向零截断（-0 归一为 0） */
function kotlinToInt(x) {
    if (Number.isNaN(x))
        return 0;
    const t = Math.trunc(x);
    return t === 0 ? 0 : t;
}
/** 预设模板（对应 Kotlin ReviewTemplate.companion） */
const SPRINT = { id: 'sprint', name: '冲刺备考', intervals: [1, 1, 2, 3, 5, 7], autoAdjust: true, isPreset: true };
const STANDARD = { id: 'standard', name: '标准记忆', intervals: [1, 2, 4, 7, 15, 30], autoAdjust: false, isPreset: true };
const DEEP = { id: 'deep', name: '深度长期', intervals: [1, 2, 4, 7, 15, 30, 60, 90], autoAdjust: false, isPreset: true };
exports.ReviewTemplate = {
    SPRINT,
    STANDARD,
    DEEP,
    PRESETS: [SPRINT, STANDARD, DEEP],
};
/** 按 timestamp 升序排序练习记录（Kotlin elements 稳定排序，JS sort 亦稳定） */
function sortByTimestamp(records) {
    return records.slice().sort((a, b) => a.timestamp - b.timestamp);
}
/** 最近一次记录的正确率（totalBlanks<=0 时为 1） */
function lastAccuracyOf(r) {
    return r.totalBlanks > 0 ? r.correctCount / r.totalBlanks : 1;
}
exports.EbbinghausScheduler = {
    /**
     * 计算下次复习日期（毫秒时间戳）
     *
     * @param template 复习模板
     * @param studyCount 已学习次数
     * @param lastStudyTime 最近一次学习时间
     * @param lastAccuracy 最近一次正确率 (0-1)，用于自适应微调
     * @return 下次应复习的时间戳，已全部完成返回 null
     */
    nextReviewTime(template, studyCount, lastStudyTime, lastAccuracy = 1) {
        if (studyCount >= template.intervals.length)
            return null;
        let interval = template.intervals[studyCount];
        // 自适应微调：正确率低 → 提前复习；正确率高 → 延后
        // 对 interval==1 单独处理，避免 *0.5 maxOf1=1 / *1.3=1 的无效微调
        if (template.autoAdjust && studyCount > 0) {
            if (lastAccuracy < 0.4) {
                interval = interval <= 1 ? 1 : Math.max(1, kotlinToInt(interval * 0.5));
            }
            else if (lastAccuracy < 0.7) {
                interval = interval <= 1 ? 1 : Math.max(1, kotlinToInt(interval * 0.75));
            }
            else if (lastAccuracy > 0.95) {
                interval = interval <= 1 ? 2 : kotlinToInt(interval * 1.3);
            }
            else if (lastAccuracy > 0.85) {
                interval = interval <= 1 ? 2 : kotlinToInt(interval * 1.15);
            }
        }
        // Calendar.add(DAY_OF_YEAR, interval)：按本地日历日推进（无 DST 情况下等价于 + interval 天）
        const d = new Date(lastStudyTime);
        d.setDate(d.getDate() + interval);
        return d.getTime();
    },
    /**
     * 判断是否需要复习
     * @param clock 可注入的当前时间源（默认 Date.now()），便于测试
     */
    isDue(template, records, clock = Date.now) {
        if (records.length === 0)
            return false;
        const sorted = sortByTimestamp(records);
        const count = sorted.length;
        // count 达到/超过复习轮次总数即视为已完成，不再 due
        if (count >= template.intervals.length)
            return false;
        const last = sorted[sorted.length - 1];
        const lastAcc = lastAccuracyOf(last);
        const nextTime = this.nextReviewTime(template, count - 1, last.timestamp, lastAcc);
        if (nextTime === null)
            return false;
        return clock() >= nextTime;
    },
    /**
     * 获取复习状态
     * @param clock 可注入的当前时间源（默认 Date.now()），便于测试
     */
    getReviewStatus(template, records, clock = Date.now) {
        if (records.length === 0)
            return { type: 'NOT_STARTED' };
        const sorted = sortByTimestamp(records);
        const count = sorted.length;
        // count 达到/超过复习轮次总数即视为已完成
        if (count >= template.intervals.length)
            return { type: 'COMPLETED' };
        const last = sorted[sorted.length - 1];
        const lastAcc = lastAccuracyOf(last);
        const nextTime = this.nextReviewTime(template, count - 1, last.timestamp, lastAcc);
        if (nextTime === null)
            return { type: 'COMPLETED' };
        const now = clock();
        if (now >= nextTime)
            return { type: 'DUE' };
        const remainingMs = nextTime - now;
        // 向上取整：剩余不足一天也显示「1 天后」，恰好整除则显示实际天数
        const remainingDays = Math.max(0, kotlinToInt(Math.ceil(remainingMs / MILLIS_PER_DAY)));
        return { type: 'PENDING', daysLeft: remainingDays };
    },
    /**
     * 获取复习状态（FSRS 优先）：
     * 文章已有 FSRS 记忆状态时，到期判断完全由 FSRS 自适应调度决定；
     * 无 FSRS 状态（升级前的存量练习）时回退到模板间隔调度。
     *
     * 对应 Kotlin 的 `getReviewStatus(fsrsState, records, template)` 重载。
     */
    getReviewStatusByFsrs(fsrsState, records, template = exports.ReviewTemplate.STANDARD, clock = Date.now) {
        // FSRS 状态存在且已有练习 → 完全采用 FSRS 调度
        if (fsrsState !== null && fsrsState.reviewCount > 0) {
            const now = clock();
            if (now >= fsrsState.due)
                return { type: 'DUE' };
            const remainingMs = fsrsState.due - now;
            const remainingDays = Math.max(0, kotlinToInt(Math.ceil(remainingMs / MILLIS_PER_DAY)));
            return { type: 'PENDING', daysLeft: remainingDays };
        }
        return this.getReviewStatus(template, records, clock);
    },
};
