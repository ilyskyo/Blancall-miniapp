/**
 * 云数据库操作集合（WorkBuddy 云服务）
 *
 * 表：user_profile / checkins / leaderboard / uploads / telemetry_events / sync_data
 * 身份：RLS owner-only，owner_id 由数据库 DEFAULT auth.uid() 填充，前端不传。
 */

import { LeaderboardResult, SpaceUsage } from './api';
import { cloud, cloudErrorText } from './cloud';
import { ApiException } from './request';
import { FREE_SPACE_BASE_BYTES } from '../config';
import { getSession } from '../storage/prefs';

function db() {
  return cloud().database;
}

function storage() {
  return cloud().storage;
}

function fail(error: unknown, fallback: string): ApiException {
  const msg = cloudErrorText(error);
  return new ApiException({ code: 'UPSTREAM_FAILED', message: msg === '操作失败，请稍后重试' ? fallback : msg, detail: error });
}

// ============================== 用户资料 ==============================

export interface CloudProfile {
  id: string;
  nickname: string;
  avatar: string | null;
  rankVisible: boolean;
  createdAt: string;
}

function toProfile(row: Record<string, unknown>): CloudProfile {
  return {
    id: String(row.id || ''),
    nickname: String(row.nickname || '学习者'),
    avatar: (row.avatar as string) || null,
    rankVisible: row.rank_visible !== false,
    createdAt: String(row.created_at || ''),
  };
}

/** 读取我的资料行（无则返回 null） */
export async function getMyProfile(): Promise<{ profile: CloudProfile | null }> {
  const { data, error } = await db().from('user_profile').select('id,nickname,avatar,rank_visible,created_at').limit(1);
  if (error) throw fail(error, '读取资料失败');
  const rows = (data || []) as Array<Record<string, unknown>>;
  return { profile: rows.length > 0 ? toProfile(rows[0]) : null };
}

/**
 * 确保资料行存在；已存在时按传入值更新（可传 null 表示不更新该字段）。
 * 返回最终资料与是否为新建（新用户）。
 */
export async function upsertMyProfile(patch: {
  nickname?: string | null;
  avatar?: string | null;
  rankVisible?: boolean | null;
}): Promise<{ profile: CloudProfile | null; isNew: boolean }> {
  const existing = await getMyProfile();
  if (!existing.profile) {
    const insertRow: Record<string, unknown> = {};
    if (patch.nickname != null) insertRow.nickname = patch.nickname;
    if (patch.avatar != null) insertRow.avatar = patch.avatar;
    if (patch.rankVisible != null) insertRow.rank_visible = patch.rankVisible;
    const { error } = await db().from('user_profile').insert(insertRow);
    if (error) throw fail(error, '创建资料失败');
    const created = await getMyProfile();
    return { profile: created.profile, isNew: true };
  }
  const updateRow: Record<string, unknown> = {};
  if (patch.nickname != null && patch.nickname !== existing.profile.nickname) updateRow.nickname = patch.nickname;
  if (patch.avatar != null && patch.avatar !== existing.profile.avatar) updateRow.avatar = patch.avatar;
  if (patch.rankVisible != null && patch.rankVisible !== existing.profile.rankVisible) updateRow.rank_visible = patch.rankVisible;
  if (Object.keys(updateRow).length > 0) {
    const { error } = await db().from('user_profile').update(updateRow).eq('id', existing.profile.id);
    if (error) throw fail(error, '更新资料失败');
  }
  const fresh = await getMyProfile();
  return { profile: fresh.profile, isNew: false };
}

/** 删除账号：清空本人全部云端数据 + 对象存储文件 + 登出（凭证释放依赖平台策略） */
export async function deleteMyAccount(): Promise<void> {
  const uid = currentUidOrThrow();
  // 对象存储：清空个人前缀（尽力而为，失败不阻塞数据行删除）
  try {
    const prefix = storage().userPath(uid, '');
    const { data: files } = await storage().list(prefix);
    const list = (files || []) as Array<{ name: string }>;
    if (list.length > 0) {
      const paths = list.map((f: { name: string }) => `${prefix}${f.name}`);
      await storage().remove(paths);
    }
  } catch {
    /* 忽略 */
  }
  for (const table of ['sync_data', 'checkins', 'telemetry_events', 'leaderboard', 'uploads']) {
    const { error } = await db().from(table).delete().eq(table === 'user_profile' ? 'id' : 'owner_id', uid);
    if (error) throw fail(error, `删除 ${table} 失败`);
  }
  const { error: profileErr } = await db().from('user_profile').delete().eq('id', uid);
  if (profileErr) throw fail(profileErr, '删除资料失败');
  await cloud().auth.signOut();
}

function currentUidOrThrow(): string {
  const s = getSession();
  if (!s || !s.userId) throw new ApiException({ code: 'UNAUTHORIZED', message: '请先登录' });
  return s.userId;
}

// ============================== 空间用量 ==============================

/** 按类型聚合本人上传用量（uploads 表真实数据） */
export async function fetchSpaceUsage(): Promise<SpaceUsage | null> {
  const { data, error } = await db().from('uploads').select('kind,size');
  if (error) throw fail(error, '读取空间用量失败');
  const rows = (data || []) as Array<{ kind: string; size: number }>;
  const byKind = new Map<string, number>();
  let used = 0;
  for (const r of rows) {
    const n = Number(r.size) || 0;
    used += n;
    byKind.set(r.kind, (byKind.get(r.kind) || 0) + n);
  }
  return {
    usedBytes: used,
    baseBytes: FREE_SPACE_BASE_BYTES,
    grantBytes: 0,
    totalBytes: FREE_SPACE_BASE_BYTES,
    items: Array.from(byKind.entries()).map(([type, size]) => ({ type, size })),
  };
}

// ============================== 签到 ==============================

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 今天签到（幂等：重复签到返回 already=true） */
export async function doCheckin(): Promise<{ already: boolean; totalDays: number }> {
  const today = dayKey(new Date());
  const { error } = await db().from('checkins').insert({ day: today }, { onConflict: 'owner_id,day', ignoreDuplicates: true });
  if (error) throw fail(error, '签到失败');
  const summary = await fetchStreakSummary();
  const already = summary.streak.checkedInToday;
  return { already, totalDays: summary.credits };
}

/** 某月签到日（含起止；month = 'YYYY-MM'） */
export async function fetchCheckinDays(month: string): Promise<string[]> {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  const { data, error } = await db().from('checkins').select('day').gte('day', start).lte('day', end).order('day');
  if (error) throw fail(error, '读取签到日历失败');
  return ((data || []) as Array<{ day: string }>).map((r) => String(r.day).slice(0, 10));
}

export interface StreakSummary {
  credits: number;
  streak: { current: number; longest: number; checkedInToday: boolean };
}

/** 全量签到连击统计（credits = 累计签到天数） */
export async function fetchStreakSummary(): Promise<StreakSummary> {
  const { data, error } = await db().from('checkins').select('day').order('day');
  if (error) throw fail(error, '读取签到数据失败');
  const days = ((data || []) as Array<{ day: string }>).map((r) => String(r.day).slice(0, 10)).sort();
  const set = new Set(days);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  let current = 0;
  if (set.has(today) || set.has(yesterday)) {
    const cursor = set.has(today) ? new Date() : new Date(Date.now() - 86400000);
    while (set.has(dayKey(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const d of days) {
    const cur = new Date(`${d}T00:00:00`);
    if (prev && Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1) run++;
    else run = 1;
    if (run > longest) longest = run;
    prev = cur;
  }
  return { credits: days.length, streak: { current, longest, checkedInToday: set.has(today) } };
}

// ============================== 排行榜 ==============================

export interface LeaderboardScores {
  creditAll: number;
  minutesAll: number;
  creditWeek: number;
  minutesWeek: number;
  nickname: string;
  avatar: string;
  rankVisible: boolean;
}

function weekStartKey(): string {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 周一=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  return dayKey(monday);
}

/** 上报我的排行数据（来自本地 study_stat / checkins 聚合；rankVisible=false 时不入库） */
export async function reportMyLeaderboardScores(s: LeaderboardScores): Promise<void> {
  if (!s.rankVisible) {
    // 用户选择不参与排行：移除已有行
    await db().from('leaderboard').delete().eq('owner_id', currentUidOrThrow());
    return;
  }
  await db().from('leaderboard').upsert(
    {
      nickname: s.nickname || '学习者',
      avatar: s.avatar || null,
      credit_all: Math.max(0, Math.round(s.creditAll)),
      minutes_all: Math.max(0, Math.round(s.minutesAll)),
      credit_week: Math.max(0, Math.round(s.creditWeek)),
      minutes_week: Math.max(0, Math.round(s.minutesWeek)),
    },
    { onConflict: 'owner_id' }
  );
}

/** 查询排行榜（top50 + 我的排名） */
export async function fetchLeaderboard(type: 'credit' | 'time', period: 'week' | 'all', limit = 50): Promise<LeaderboardResult> {
  const column = type === 'credit' ? (period === 'week' ? 'credit_week' : 'credit_all') : period === 'week' ? 'minutes_week' : 'minutes_all';
  const { data, error } = await db()
    .from('leaderboard')
    .select('owner_id,nickname,credit_all,minutes_all,credit_week,minutes_week')
    .order(column, { ascending: false })
    .limit(limit);
  if (error) throw fail(error, '读取排行榜失败');
  const rows = (data || []) as Array<Record<string, unknown>>;
  const uid = currentUidSafe();
  const top = rows.map((r, i) => ({
    rank: i + 1,
    nickname: String(r.nickname || '学习者'),
    score: Number(r[column]) || 0,
    isMe: String(r.owner_id || '') === uid,
  }));
  const mine = top.find((t) => t.isMe) || null;
  void weekStartKey;
  return { top, me: mine ? { rank: mine.rank, score: mine.score } : null };
}

function currentUidSafe(): string {
  try {
    const s = getSession();
    return (s && s.userId) || '';
  } catch {
    return '';
  }
}
