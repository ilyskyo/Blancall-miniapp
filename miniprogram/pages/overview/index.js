"use strict";
/**
 * 数据总览（tabBar 第 3 项）：全局统计 / 今日目标 / 即将遗忘 / 句子记忆 / 趋势 / 日历 /
 * 能力画像（雷达 + 模式对比 + 进步趋势）/ 成就 / 需加强文章 / 标签分布 / 最近训练分析
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
const prefs_1 = require("../../core/storage/prefs");
const auth_1 = require("../../core/net/auth");
const indexLogic_1 = require("./indexLogic");
const GOAL_PRESETS = [1, 3, 5, 10];
let offTheme = null;
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        view: null,
        checkinCheckedIn: false,
        checkinStreak: 0,
        analysis: null,
    },
    onLoad() {
        this.__destroyed = false;
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        this.refresh();
    },
    onReady() {
        this.drawRadarChart();
    },
    onShow() {
        const tb = this.getTabBar && this.getTabBar();
        if (tb)
            tb.setData({ selected: 2 });
        this.refresh();
        void (0, auth_1.loadEntitlements)()
            .then(() => this.refreshCheckin())
            .catch(() => this.refreshCheckin());
    },
    onUnload() {
        this.__destroyed = true;
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    /** 重算全部统计 */
    refresh() {
        const view = (0, indexLogic_1.buildOverview)();
        this.setData({ view, analysis: (0, indexLogic_1.readLastAnalysis)() });
        this.refreshCheckin();
        setTimeout(() => this.drawRadarChart(), 60);
    },
    refreshCheckin() {
        if (this.__destroyed)
            return;
        const ent = (0, auth_1.entitlementsSnapshot)();
        this.setData({
            checkinCheckedIn: ent ? ent.streak.checkedInToday : false,
            checkinStreak: ent ? ent.streak.current : 0,
        });
    },
    /** 绘制弱点雷达（canvas 2D） */
    drawRadarChart() {
        const view = this.data.view;
        if (!view || view.practiceCount <= 0)
            return;
        wx.createSelectorQuery()
            .select('#radar')
            .fields({ node: true, size: true })
            .exec((res) => {
            const item = res && res[0];
            if (!item || !item.node)
                return;
            let dpr = 2;
            try {
                const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
                dpr = info.pixelRatio || 2;
            }
            catch {
                dpr = 2;
            }
            (0, indexLogic_1.drawRadar)(item.node, item.width || 300, item.height || 200, dpr, view.radarValues, view.radarLabels);
        });
    },
    // ---------- 入口跳转 ----------
    onTapCheckin() {
        wx.navigateTo({ url: '/packages/account/pages/checkin/index' });
    },
    onTapLeaderboard() {
        wx.navigateTo({ url: '/packages/account/pages/leaderboard/index' });
    },
    onTapArticle(e) {
        const uuid = String(e.currentTarget.dataset.uuid || '');
        if (!uuid)
            return;
        wx.navigateTo({ url: `/pages/practice/index?articleUuid=${uuid}` });
    },
    onTapAnalysis() {
        wx.navigateTo({ url: '/packages/ai/pages/ai-history/index?section=analysis' });
    },
    // ---------- 今日目标 ----------
    onChangeGoal() {
        wx.showActionSheet({
            itemList: ['1 次', '3 次', '5 次', '10 次', '自定义…'],
            success: (res) => {
                if (res.tapIndex < GOAL_PRESETS.length) {
                    (0, prefs_1.updateSettings)({ dailyPracticeGoal: GOAL_PRESETS[res.tapIndex] });
                    this.refresh();
                    return;
                }
                const cur = this.data.view ? this.data.view.todayGoal : 3;
                wx.showModal({
                    title: '自定义每日目标',
                    editable: true,
                    placeholderText: '输入每日练习次数（1–99）',
                    content: String(cur),
                    success: (m) => {
                        if (!m.confirm)
                            return;
                        const n = Math.max(1, Math.min(99, parseInt(m.content || '3', 10) || 3));
                        (0, prefs_1.updateSettings)({ dailyPracticeGoal: n });
                        this.refresh();
                    },
                });
            },
        });
    },
});
