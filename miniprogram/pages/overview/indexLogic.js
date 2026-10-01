"use strict";
/**
 * 数据总览辅助逻辑：统计口径整形 + （雷达）canvas 2D 自绘
 * WXML 不支持函数调用，所有派生数据在此算好。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawRadar = exports.readLastAnalysis = exports.buildOverview = void 0;
const overview_1 = require("../../core/stats/overview");
const forgetting_1 = require("../../core/algorithms/forgetting");
const prefs_1 = require("../../core/storage/prefs");
const theme_1 = require("../../core/theme/theme");
const date_1 = require("../../core/utils/date");
function pct(v) {
    return Math.round(v * 100);
}
/** 紧急度 → 文案与样式类 */
function urgencyOf(p) {
    if (p.urgency === forgetting_1.Urgency.OVERDUE) {
        const d = p.daysLeft < 0 ? -p.daysLeft : 1;
        return { label: '已逾期', klass: 'u-overdue', days: `逾期 ${d} 天` };
    }
    if (p.urgency === forgetting_1.Urgency.TODAY)
        return { label: '今天', klass: 'u-today', days: '今天应复习' };
    return { label: '即将', klass: 'u-soon', days: `${Math.max(0, p.daysLeft)} 天后` };
}
/** 构建近 84 天日历（按周分列，行 = 周内日） */
function buildCalendarWeeks() {
    const days = (0, overview_1.calendar)(84);
    if (days.length === 0)
        return [];
    const first = new Date(`${days[0].date}T00:00:00`).getDay(); // 0=周日
    const cells = [];
    for (let i = 0; i < first; i++)
        cells.push({ key: `pad${i}`, blank: true, active: false, level: 0 });
    for (const d of days) {
        const level = d.seconds >= 1800 ? 4 : d.seconds >= 900 ? 3 : d.seconds >= 300 ? 2 : d.seconds > 0 ? 1 : 0;
        cells.push({ key: d.date, blank: false, active: d.active, level });
    }
    while (cells.length % 7 !== 0)
        cells.push({ key: `tail${cells.length}`, blank: true, active: false, level: 0 });
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7)
        weeks.push({ k: `w${i / 7}`, days: cells.slice(i, i + 7) });
    return weeks;
}
/** 聚合总览数据 */
function buildOverview() {
    const s = (0, overview_1.globalStats)();
    const goal = (0, prefs_1.getSettings)().dailyPracticeGoal || 3;
    const accuracyPercent = pct(s.accuracy);
    const todayDone = s.todayCount;
    const todayPercent = goal > 0 ? Math.min(100, Math.round((todayDone / goal) * 100)) : 0;
    const due = (0, overview_1.dueSoon)(5).map((p) => {
        const u = urgencyOf(p);
        return {
            articleUuid: p.articleId,
            title: p.title,
            urgencyLabel: u.label,
            urgencyClass: u.klass,
            daysText: u.days,
            retentionPercent: pct(p.retentionRate),
        };
    });
    const sm = (0, overview_1.sentenceMemory)();
    const rawTrend = (0, overview_1.dailyTrend)(14);
    const maxCount = rawTrend.reduce((m, t) => Math.max(m, t.count), 0);
    const trend = rawTrend.map((t) => ({
        label: t.label,
        count: t.count,
        heightPercent: maxCount > 0 ? Math.max(t.count > 0 ? 6 : 0, Math.round((t.count / maxCount) * 100)) : 0,
        accuracyPercent: pct(t.accuracy),
    }));
    const weak = (0, overview_1.weaknessProfile)();
    const progress = (0, overview_1.progressTrend)();
    const modes = (0, overview_1.modeComparison)().map((m) => ({
        label: m.label,
        count: m.count,
        accuracyPercent: pct(m.accuracy),
    }));
    const ach = (0, overview_1.achievements)().map((a) => ({
        id: a.id,
        icon: a.icon,
        title: a.title,
        description: a.description,
        unlocked: a.unlocked,
        progressPercent: Math.round(a.progress * 100),
        progressText: a.progressText,
    }));
    const weakest = (0, overview_1.weakestArticles)(3).map((w) => ({
        articleUuid: w.articleUuid,
        title: w.title,
        accuracyPercent: pct(w.accuracy),
    }));
    const tags = (0, overview_1.tagDistribution)()
        .slice(0, 12)
        .map((t) => ({ name: t.name, count: t.count, colorIndex: ((t.color % 6) + 6) % 6 }));
    const progressLabel = progress.trend === 'up' ? '稳步进步' : progress.trend === 'down' ? '略有退步' : '基本持平';
    const deltaSign = progress.delta > 0 ? '+' : '';
    const progressClass = progress.trend === 'up' ? 'trend-up' : progress.trend === 'down' ? 'trend-down' : 'trend-flat';
    const accuracyRing = `background: conic-gradient(var(--accent) 0 ${accuracyPercent}%, var(--border) ${accuracyPercent}% 100%)`;
    return {
        accuracyPercent,
        accuracyRing,
        streak: s.streak,
        longestStreak: s.longestStreak,
        studyText: (0, date_1.formatDuration)(s.studySeconds),
        readingText: (0, date_1.formatDuration)(s.readingSeconds),
        practiceCount: s.practiceCount,
        articleCount: s.articleCount,
        totalBlanks: s.totalBlanks,
        todayGoal: goal,
        todayDone,
        todayPercent,
        due,
        sentence: {
            remembered: sm.remembered,
            totalReviews: sm.totalReviews,
            forgettingPercent: pct(sm.forgettingRate),
            avgRetentionPercent: pct(sm.avgRetention),
            dueToday: sm.dueToday,
        },
        trend,
        calendarWeeks: buildCalendarWeeks(),
        weakness: weak.map((w) => ({ label: w.label, ratioPercent: pct(w.ratio) })),
        radarLabels: weak.map((w) => w.label),
        radarValues: weak.map((w) => w.ratio),
        modes,
        progressLabel,
        progressDeltaText: `${deltaSign}${(progress.delta * 100).toFixed(1)}%`,
        progressClass,
        achievements: ach,
        weakest,
        tags,
        hasData: s.practiceCount > 0,
    };
}
exports.buildOverview = buildOverview;
/** 读取最近一次 AI 训练分析（由 AI 分包写入；不存在则隐藏卡片） */
function readLastAnalysis() {
    try {
        const raw = wx.getStorageSync('last_analysis');
        if (!raw)
            return null;
        if (typeof raw === 'string')
            return raw.trim() ? { title: '最近训练分析', markdown: raw } : null;
        const obj = raw;
        const markdown = obj.markdown || obj.text || '';
        return markdown ? { title: obj.title || '最近训练分析', markdown } : null;
    }
    catch {
        return null;
    }
}
exports.readLastAnalysis = readLastAnalysis;
/**
 * canvas 2D 绘制弱点雷达（4 轴：错字/漏字/多填/乱序）。
 * 颜色取自主题模块，避免硬编码。
 */
function drawRadar(canvas, width, height, dpr, values, labels) {
    if (!canvas || !width || !height)
        return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return;
    ctx.scale(dpr, dpr);
    const t = (0, theme_1.currentTheme)();
    const n = values.length;
    if (n < 3)
        return;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 26;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const point = (i, r) => ({
        x: cx + Math.cos(angle(i)) * r,
        y: cy + Math.sin(angle(i)) * r,
    });
    // 网格环
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.border;
    for (let ring = 1; ring <= 4; ring++) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const p = point(i, (radius * ring) / 4);
            if (i === 0)
                ctx.moveTo(p.x, p.y);
            else
                ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
    }
    // 轴线
    for (let i = 0; i < n; i++) {
        const p = point(i, radius);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }
    // 数据多边形
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const v = Math.max(0, Math.min(1, values[i] || 0));
        const p = point(i, radius * Math.max(0.04, v));
        if (i === 0)
            ctx.moveTo(p.x, p.y);
        else
            ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = t.accentSoft;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.accent;
    ctx.stroke();
    // 标签
    ctx.fillStyle = t.textSecondary;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
        const p = point(i, radius + 14);
        ctx.fillText(labels[i] || '', p.x, p.y);
    }
}
exports.drawRadar = drawRadar;
