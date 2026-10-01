/**
 * 日期与时间工具（与 Android 端口径一致：毫秒时间戳；统计按本地自然日聚合）
 */

export const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** YYYY-MM-DD（本地时区） */
export function dateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM（本地时区） */
export function monthKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** 当日 00:00:00.000 的时间戳 */
export function startOfDay(ts: number = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 两个时间戳相差的自然天数（按本地零点计算） */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / MILLIS_PER_DAY);
}

/** 格式：MM-dd HH:mm */
export function formatShort(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 格式：YYYY-MM-DD HH:mm */
export function formatFull(ts: number): string {
  const d = new Date(ts);
  return `${dateKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 秒 → "1小时23分" / "23分04秒" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}小时${pad(m)}分`;
  if (m > 0) return `${m}分${pad(sec)}秒`;
  return `${sec}秒`;
}

/** 耗时（毫秒）→ 展示文案 */
export function formatMillis(ms: number): string {
  return formatDuration(Math.round(ms / 1000));
}

/** 近 N 天的日期键（含今天，升序） */
export function lastNDays(n: number, end: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dateKey(end - i * MILLIS_PER_DAY));
  return out;
}

/** 某月天数 */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}