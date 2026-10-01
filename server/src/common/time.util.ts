/**
 * 时区与日期工具：全部业务日期按 Asia/Shanghai（UTC+8，无夏令时）自然日计算
 */

export const CN_OFFSET_MS = 8 * 60 * 60 * 1000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 取某时刻对应的中国自然日字符串 YYYY-MM-DD */
export function cnDateString(at: Date = new Date()): string {
  return new Date(at.getTime() + CN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 把 YYYY-MM-DD 转为用于 @db.Date 列写入的 Date（UTC 零点） */
export function cnDateFromString(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** 取某时刻对应的中国自然日（用于 DATE 列） */
export function cnDate(at: Date = new Date()): Date {
  return cnDateFromString(cnDateString(at));
}

/** DATE 列读回后转为 YYYY-MM-DD */
export function dateToCnString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** 中国自然日往前一天 */
export function cnYesterdayStr(at: Date = new Date()): string {
  return cnDateString(new Date(at.getTime() - MS_PER_DAY));
}

/** 某自然日所在周的周一（中国自然日） */
export function cnWeekStartStr(s: string): string {
  const d = cnDateFromString(s);
  // getUTCDay: 0=周日 .. 6=周六
  const dow = d.getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  return dateToCnString(new Date(d.getTime() - delta * MS_PER_DAY));
}

/** 生成某月的全部自然日（YYYY-MM） */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map((n) => Number.parseInt(n, 10));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days: string[] = [];
  for (let i = 0; i < 31; i += 1) {
    const d = new Date(first.getTime() + i * MS_PER_DAY);
    if (d.getUTCMonth() !== m - 1) break;
    days.push(dateToCnString(d));
  }
  return days;
}

/** 当前月份的 YYYY-MM */
export function currentMonth(at: Date = new Date()): string {
  return cnDateString(at).slice(0, 7);
}

/** Date → 毫秒时间戳（用于响应体，避免 BigInt/Date 序列化问题） */
export function toMs(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

/** BigInt → number（响应体统一用 number，避免 JSON.stringify 报错） */
export function toNum(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}

/** 解析客户端传入的 updatedAt（支持毫秒时间戳 / ISO 字符串） */
export function parseUpdatedAt(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && /^\d+$/.test(v.trim())) return new Date(n);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}