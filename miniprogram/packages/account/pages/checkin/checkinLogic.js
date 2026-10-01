"use strict";
/**
 * 签到页辅助逻辑：连击里程碑进度 + 月历网格
 * 注：里程碑奖励（体验卡/卡）随支付上线后启用，当前仅展示连击进度
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthLabel = exports.shiftMonth = exports.buildCalendar = exports.buildMilestones = exports.MILESTONE_DAYS = void 0;
const date_1 = require("../../../../core/utils/date");
/** 连续签到里程碑（天） */
exports.MILESTONE_DAYS = [3, 7, 10, 15, 30];
/** 构建里程碑进度（以当前连续天数为准） */
function buildMilestones(streak) {
    return exports.MILESTONE_DAYS.map((days) => ({
        days,
        label: `连续 ${days} 天`,
        reached: streak >= days,
    }));
}
exports.buildMilestones = buildMilestones;
function pad(n) {
    return String(n).padStart(2, '0');
}
/** 构建月历网格（days = 已签到的日期键列表，含首尾补空，按周日起） */
function buildCalendar(month, days, todayKey) {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const m = Number(monthStr);
    if (!year || !m)
        return [];
    const checked = new Set(days);
    const firstWeekday = new Date(year, m - 1, 1).getDay();
    const count = (0, date_1.daysInMonth)(year, m);
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) {
        cells.push({ key: `lead-${i}`, day: 0, empty: true, checkedIn: false, today: false });
    }
    for (let day = 1; day <= count; day++) {
        const date = `${month}-${pad(day)}`;
        cells.push({
            key: date,
            day,
            empty: false,
            checkedIn: checked.has(date),
            today: date === todayKey,
        });
    }
    while (cells.length % 7 !== 0) {
        cells.push({ key: `tail-${cells.length}`, day: 0, empty: true, checkedIn: false, today: false });
    }
    return cells;
}
exports.buildCalendar = buildCalendar;
/** 月份偏移（month: YYYY-MM） */
function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
exports.shiftMonth = shiftMonth;
/** 月份标题 */
function monthLabel(month) {
    const [y, m] = month.split('-');
    return `${y} 年 ${Number(m)} 月`;
}
exports.monthLabel = monthLabel;
