"use strict";
/**
 * 签到：每日 +1 credit / 连续天数 / 里程碑体验卡 / 月历
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const auth_1 = require("../../../../core/net/auth");
const cloudapi_1 = require("../../../../core/net/cloudapi");
const prefs_1 = require("../../../../core/storage/prefs");
const date_1 = require("../../../../core/utils/date");
const checkinLogic_1 = require("./checkinLogic");
let offTheme = null;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        loggedIn: false,
        month: '',
        monthLabel: '',
        canGoNext: false,
        weekdays: WEEKDAYS,
        cells: [],
        todayChecked: false,
        checking: false,
        credits: 0,
        streakCurrent: 0,
        streakLongest: 0,
        milestones: [],
        rewardText: '',
    },
    onLoad() {
        this.__destroyed = false;
        this.setData({ themeStyle: (0, theme_1.themeStyle)(), month: (0, date_1.monthKey)(), monthLabel: (0, checkinLogic_1.monthLabel)((0, date_1.monthKey)()) });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
    },
    onShow() {
        if (!(0, prefs_1.isLoggedIn)()) {
            this.setData({ loggedIn: false });
            (0, auth_1.requireLogin)({});
            this.applyEntitlements();
            return;
        }
        this.setData({ loggedIn: true });
        void this.load();
    },
    onUnload() {
        this.__destroyed = true;
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    async load() {
        this.applyEntitlements();
        await Promise.all([this.loadCalendar(this.data.month), (0, auth_1.loadEntitlements)(true).then(() => this.applyEntitlements()).catch(() => undefined)]);
    },
    /** 从权益快照同步 credits / 连续天数 / 今日状态 */
    applyEntitlements() {
        if (this.__destroyed)
            return;
        const ent = (0, auth_1.entitlementsSnapshot)();
        const streak = ent ? ent.streak.current : 0;
        this.setData({
            credits: ent ? ent.credits : 0,
            streakCurrent: streak,
            streakLongest: ent ? ent.streak.longest : 0,
            todayChecked: ent ? ent.streak.checkedInToday : false,
            milestones: (0, checkinLogic_1.buildMilestones)(streak),
        });
    },
    async loadCalendar(month) {
        this.setData({ month, monthLabel: (0, checkinLogic_1.monthLabel)(month), canGoNext: month < (0, date_1.monthKey)() });
        try {
            const days = await (0, cloudapi_1.fetchCheckinDays)(month);
            if (this.__destroyed)
                return;
            this.setData({ cells: (0, checkinLogic_1.buildCalendar)(month, days || [], (0, date_1.dateKey)()) });
        }
        catch (e) {
            if (this.__destroyed)
                return;
            this.setData({ cells: (0, checkinLogic_1.buildCalendar)(month, [], (0, date_1.dateKey)()) });
            wx.showToast({ title: e instanceof Error ? e.message : '日历加载失败', icon: 'none' });
        }
    },
    async onCheckin() {
        if (!(0, auth_1.requireLogin)({}))
            return;
        if (this.data.todayChecked || this.data.checking)
            return;
        this.setData({ checking: true });
        try {
            const res = await (0, cloudapi_1.doCheckin)();
            if (this.__destroyed)
                return;
            const rewardText = res.already ? '今天已签到过了' : `已签到，连续 ${this.data.streakCurrent + 1} 天`;
            this.setData({ todayChecked: true, rewardText });
            await (0, auth_1.loadEntitlements)(true).catch(() => undefined);
            this.applyEntitlements();
            await this.loadCalendar(this.data.month);
            wx.showModal({ title: '签到成功', content: rewardText, showCancel: false, confirmText: '我知道了' });
        }
        catch (e) {
            wx.showToast({ title: e instanceof Error ? e.message : '签到失败，请稍后重试', icon: 'none' });
        }
        finally {
            if (!this.__destroyed)
                this.setData({ checking: false });
        }
    },
    onPrevMonth() {
        void this.loadCalendar((0, checkinLogic_1.shiftMonth)(this.data.month, -1));
    },
    onNextMonth() {
        if (!this.data.canGoNext)
            return;
        void this.loadCalendar((0, checkinLogic_1.shiftMonth)(this.data.month, 1));
    },
    onTapLeaderboard() {
        wx.navigateTo({ url: '/packages/account/pages/leaderboard/index' });
    },
    async onGoLogin() {
        try {
            await (0, auth_1.login)();
            if (this.__destroyed)
                return;
            this.setData({ loggedIn: true });
            void this.load();
        }
        catch (e) {
            wx.showToast({ title: e instanceof Error ? e.message : '登录失败', icon: 'none' });
        }
    },
});
