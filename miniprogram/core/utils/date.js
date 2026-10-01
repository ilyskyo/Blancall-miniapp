"use strict";
/**
 * 日期与时间工具（与 Android 端口径一致：毫秒时间戳；统计按本地自然日聚合）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysInMonth = exports.lastNDays = exports.formatMillis = exports.formatDuration = exports.formatFull = exports.formatShort = exports.dayDiff = exports.startOfDay = exports.monthKey = exports.dateKey = exports.MILLIS_PER_DAY = void 0;
exports.MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
function pad(n, len = 2) {
    return String(n).padStart(len, '0');
}
/** YYYY-MM-DD（本地时区） */
function dateKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
exports.dateKey = dateKey;
/** YYYY-MM（本地时区） */
function monthKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
exports.monthKey = monthKey;
/** 当日 00:00:00.000 的时间戳 */
function startOfDay(ts = Date.now()) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
exports.startOfDay = startOfDay;
/** 两个时间戳相差的自然天数（按本地零点计算） */
function dayDiff(a, b) {
    return Math.round((startOfDay(a) - startOfDay(b)) / exports.MILLIS_PER_DAY);
}
exports.dayDiff = dayDiff;
/** 格式：MM-dd HH:mm */
function formatShort(ts) {
    const d = new Date(ts);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
exports.formatShort = formatShort;
/** 格式：YYYY-MM-DD HH:mm */
function formatFull(ts) {
    const d = new Date(ts);
    return `${dateKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
exports.formatFull = formatFull;
/** 秒 → "1小时23分" / "23分04秒" */
function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0)
        return `${h}小时${pad(m)}分`;
    if (m > 0)
        return `${m}分${pad(sec)}秒`;
    return `${sec}秒`;
}
exports.formatDuration = formatDuration;
/** 耗时（毫秒）→ 展示文案 */
function formatMillis(ms) {
    return formatDuration(Math.round(ms / 1000));
}
exports.formatMillis = formatMillis;
/** 近 N 天的日期键（含今天，升序） */
function lastNDays(n, end = Date.now()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--)
        out.push(dateKey(end - i * exports.MILLIS_PER_DAY));
    return out;
}
exports.lastNDays = lastNDays;
/** 某月天数 */
function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate();
}
exports.daysInMonth = daysInMonth;
