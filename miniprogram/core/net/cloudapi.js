"use strict";
/**
 * 云数据库操作集合（WorkBuddy 云服务）
 *
 * 表：user_profile / checkins / leaderboard / uploads / telemetry_events / sync_data
 * 身份：RLS owner-only，owner_id 由数据库 DEFAULT auth.uid() 填充，前端不传。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLeaderboard = exports.reportMyLeaderboardScores = exports.fetchStreakSummary = exports.fetchCheckinDays = exports.doCheckin = exports.fetchSpaceUsage = exports.deleteMyAccount = exports.upsertMyProfile = exports.getMyProfile = void 0;
const cloud_1 = require("./cloud");
const request_1 = require("./request");
const config_1 = require("../config");
const prefs_1 = require("../storage/prefs");
function db() {
    return (0, cloud_1.cloud)().database;
}
function storage() {
    return (0, cloud_1.cloud)().storage;
}
function fail(error, fallback) {
    const msg = (0, cloud_1.cloudErrorText)(error);
    return new request_1.ApiException({ code: 'UPSTREAM_FAILED', message: msg === '操作失败，请稍后重试' ? fallback : msg, detail: error });
}
function toProfile(row) {
    return {
        id: String(row.id || ''),
        nickname: String(row.nickname || '学习者'),
        avatar: row.avatar || null,
        rankVisible: row.rank_visible !== false,
        createdAt: String(row.created_at || ''),
    };
}
/** 读取我的资料行（无则返回 null） */
async function getMyProfile() {
    const { data, error } = await db().from('user_profile').select('id,nickname,avatar,rank_visible,created_at').limit(1);
    if (error)
        throw fail(error, '读取资料失败');
    const rows = (data || []);
    return { profile: rows.length > 0 ? toProfile(rows[0]) : null };
}
exports.getMyProfile = getMyProfile;
/**
 * 确保资料行存在；已存在时按传入值更新（可传 null 表示不更新该字段）。
 * 返回最终资料与是否为新建（新用户）。
 */
async function upsertMyProfile(patch) {
    const existing = await getMyProfile();
    if (!existing.profile) {
        const insertRow = {};
        if (patch.nickname != null)
            insertRow.nickname = patch.nickname;
        if (patch.avatar != null)
            insertRow.avatar = patch.avatar;
        if (patch.rankVisible != null)
            insertRow.rank_visible = patch.rankVisible;
        const { error } = await db().from('user_profile').insert(insertRow);
        if (error)
            throw fail(error, '创建资料失败');
        const created = await getMyProfile();
        return { profile: created.profile, isNew: true };
    }
    const updateRow = {};
    if (patch.nickname != null && patch.nickname !== existing.profile.nickname)
        updateRow.nickname = patch.nickname;
    if (patch.avatar != null && patch.avatar !== existing.profile.avatar)
        updateRow.avatar = patch.avatar;
    if (patch.rankVisible != null && patch.rankVisible !== existing.profile.rankVisible)
        updateRow.rank_visible = patch.rankVisible;
    if (Object.keys(updateRow).length > 0) {
        const { error } = await db().from('user_profile').update(updateRow).eq('id', existing.profile.id);
        if (error)
            throw fail(error, '更新资料失败');
    }
    const fresh = await getMyProfile();
    return { profile: fresh.profile, isNew: false };
}
exports.upsertMyProfile = upsertMyProfile;
/** 删除账号：清空本人全部云端数据 + 对象存储文件 + 登出（凭证释放依赖平台策略） */
async function deleteMyAccount() {
    const uid = currentUidOrThrow();
    // 对象存储：清空个人前缀（尽力而为，失败不阻塞数据行删除）
    try {
        const prefix = storage().userPath(uid, '');
        const { data: files } = await storage().list(prefix);
        const list = (files || []);
        if (list.length > 0) {
            const paths = list.map((f) => `${prefix}${f.name}`);
            await storage().remove(paths);
        }
    }
    catch {
        /* 忽略 */
    }
    for (const table of ['sync_data', 'checkins', 'telemetry_events', 'leaderboard', 'uploads']) {
        const { error } = await db().from(table).delete().eq(table === 'user_profile' ? 'id' : 'owner_id', uid);
        if (error)
            throw fail(error, `删除 ${table} 失败`);
    }
    const { error: profileErr } = await db().from('user_profile').delete().eq('id', uid);
    if (profileErr)
        throw fail(profileErr, '删除资料失败');
    await (0, cloud_1.cloud)().auth.signOut();
}
exports.deleteMyAccount = deleteMyAccount;
function currentUidOrThrow() {
    const s = (0, prefs_1.getSession)();
    if (!s || !s.userId)
        throw new request_1.ApiException({ code: 'UNAUTHORIZED', message: '请先登录' });
    return s.userId;
}
// ============================== 空间用量 ==============================
/** 按类型聚合本人上传用量（uploads 表真实数据） */
async function fetchSpaceUsage() {
    const { data, error } = await db().from('uploads').select('kind,size');
    if (error)
        throw fail(error, '读取空间用量失败');
    const rows = (data || []);
    const byKind = new Map();
    let used = 0;
    for (const r of rows) {
        const n = Number(r.size) || 0;
        used += n;
        byKind.set(r.kind, (byKind.get(r.kind) || 0) + n);
    }
    return {
        usedBytes: used,
        baseBytes: config_1.FREE_SPACE_BASE_BYTES,
        grantBytes: 0,
        totalBytes: config_1.FREE_SPACE_BASE_BYTES,
        items: Array.from(byKind.entries()).map(([type, size]) => ({ type, size })),
    };
}
exports.fetchSpaceUsage = fetchSpaceUsage;
// ============================== 签到 ==============================
function dayKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
/** 今天签到（幂等：重复签到返回 already=true） */
async function doCheckin() {
    const today = dayKey(new Date());
    const { error } = await db().from('checkins').insert({ day: today }, { onConflict: 'owner_id,day', ignoreDuplicates: true });
    if (error)
        throw fail(error, '签到失败');
    const summary = await fetchStreakSummary();
    const already = summary.streak.checkedInToday;
    return { already, totalDays: summary.credits };
}
exports.doCheckin = doCheckin;
/** 某月签到日（含起止；month = 'YYYY-MM'） */
async function fetchCheckinDays(month) {
    const [y, m] = month.split('-').map(Number);
    const start = `${month}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${month}-${String(lastDay).padStart(2, '0')}`;
    const { data, error } = await db().from('checkins').select('day').gte('day', start).lte('day', end).order('day');
    if (error)
        throw fail(error, '读取签到日历失败');
    return (data || []).map((r) => String(r.day).slice(0, 10));
}
exports.fetchCheckinDays = fetchCheckinDays;
/** 全量签到连击统计（credits = 累计签到天数） */
async function fetchStreakSummary() {
    const { data, error } = await db().from('checkins').select('day').order('day');
    if (error)
        throw fail(error, '读取签到数据失败');
    const days = (data || []).map((r) => String(r.day).slice(0, 10)).sort();
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
    let prev = null;
    for (const d of days) {
        const cur = new Date(`${d}T00:00:00`);
        if (prev && Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1)
            run++;
        else
            run = 1;
        if (run > longest)
            longest = run;
        prev = cur;
    }
    return { credits: days.length, streak: { current, longest, checkedInToday: set.has(today) } };
}
exports.fetchStreakSummary = fetchStreakSummary;
function weekStartKey() {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 周一=0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    return dayKey(monday);
}
/** 上报我的排行数据（来自本地 study_stat / checkins 聚合；rankVisible=false 时不入库） */
async function reportMyLeaderboardScores(s) {
    if (!s.rankVisible) {
        // 用户选择不参与排行：移除已有行
        await db().from('leaderboard').delete().eq('owner_id', currentUidOrThrow());
        return;
    }
    await db().from('leaderboard').upsert({
        nickname: s.nickname || '学习者',
        avatar: s.avatar || null,
        credit_all: Math.max(0, Math.round(s.creditAll)),
        minutes_all: Math.max(0, Math.round(s.minutesAll)),
        credit_week: Math.max(0, Math.round(s.creditWeek)),
        minutes_week: Math.max(0, Math.round(s.minutesWeek)),
    }, { onConflict: 'owner_id' });
}
exports.reportMyLeaderboardScores = reportMyLeaderboardScores;
/** 查询排行榜（top50 + 我的排名） */
async function fetchLeaderboard(type, period, limit = 50) {
    const column = type === 'credit' ? (period === 'week' ? 'credit_week' : 'credit_all') : period === 'week' ? 'minutes_week' : 'minutes_all';
    const { data, error } = await db()
        .from('leaderboard')
        .select('owner_id,nickname,credit_all,minutes_all,credit_week,minutes_week')
        .order(column, { ascending: false })
        .limit(limit);
    if (error)
        throw fail(error, '读取排行榜失败');
    const rows = (data || []);
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
exports.fetchLeaderboard = fetchLeaderboard;
function currentUidSafe() {
    try {
        const s = (0, prefs_1.getSession)();
        return (s && s.userId) || '';
    }
    catch {
        return '';
    }
}
