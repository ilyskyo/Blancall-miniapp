/**
 * 签到：每日 +1 credit / 连续天数 / 里程碑体验卡 / 月历
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { entitlementsSnapshot, loadEntitlements, requireLogin, login } from '../../../../core/net/auth';
import { doCheckin, fetchCheckinDays } from '../../../../core/net/cloudapi';
import { isLoggedIn } from '../../../../core/storage/prefs';
import { dateKey, monthKey } from '../../../../core/utils/date';
import { DayCell, Milestone, buildCalendar, buildMilestones, monthLabel, shiftMonth } from './checkinLogic';

let offTheme: (() => void) | null = null;

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
    cells: [] as DayCell[],
    todayChecked: false,
    checking: false,
    credits: 0,
    streakCurrent: 0,
    streakLongest: 0,
    milestones: [] as Milestone[],
    rewardText: '',
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle(), month: monthKey(), monthLabel: monthLabel(monthKey()) });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
  },

  onShow() {
    if (!isLoggedIn()) {
      this.setData({ loggedIn: false });
      requireLogin({});
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
    await Promise.all([this.loadCalendar(this.data.month), loadEntitlements(true).then(() => this.applyEntitlements()).catch(() => undefined)]);
  },

  /** 从权益快照同步 credits / 连续天数 / 今日状态 */
  applyEntitlements() {
    if (this.__destroyed) return;
    const ent = entitlementsSnapshot();
    const streak = ent ? ent.streak.current : 0;
    this.setData({
      credits: ent ? ent.credits : 0,
      streakCurrent: streak,
      streakLongest: ent ? ent.streak.longest : 0,
      todayChecked: ent ? ent.streak.checkedInToday : false,
      milestones: buildMilestones(streak),
    });
  },

  async loadCalendar(month: string) {
    this.setData({ month, monthLabel: monthLabel(month), canGoNext: month < monthKey() });
    try {
      const days = await fetchCheckinDays(month);
      if (this.__destroyed) return;
      this.setData({ cells: buildCalendar(month, days || [], dateKey()) });
    } catch (e) {
      if (this.__destroyed) return;
      this.setData({ cells: buildCalendar(month, [], dateKey()) });
      wx.showToast({ title: e instanceof Error ? e.message : '日历加载失败', icon: 'none' });
    }
  },

  async onCheckin() {
    if (!requireLogin({})) return;
    if (this.data.todayChecked || this.data.checking) return;
    this.setData({ checking: true });
    try {
      const res = await doCheckin();
      if (this.__destroyed) return;
      const rewardText = res.already ? '今天已签到过了' : `已签到，连续 ${this.data.streakCurrent + 1} 天`;
      this.setData({ todayChecked: true, rewardText });
      await loadEntitlements(true).catch(() => undefined);
      this.applyEntitlements();
      await this.loadCalendar(this.data.month);
      wx.showModal({ title: '签到成功', content: rewardText, showCancel: false, confirmText: '我知道了' });
    } catch (e) {
      wx.showToast({ title: e instanceof Error ? e.message : '签到失败，请稍后重试', icon: 'none' });
    } finally {
      if (!this.__destroyed) this.setData({ checking: false });
    }
  },

  onPrevMonth() {
    void this.loadCalendar(shiftMonth(this.data.month, -1));
  },

  onNextMonth() {
    if (!this.data.canGoNext) return;
    void this.loadCalendar(shiftMonth(this.data.month, 1));
  },

  onTapLeaderboard() {
    wx.navigateTo({ url: '/packages/account/pages/leaderboard/index' });
  },

  async onGoLogin() {
    try {
      await login();
      if (this.__destroyed) return;
      this.setData({ loggedIn: true });
      void this.load();
    } catch (e) {
      wx.showToast({ title: e instanceof Error ? e.message : '登录失败', icon: 'none' });
    }
  },
});