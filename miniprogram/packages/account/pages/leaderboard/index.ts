/**
 * 排行榜：Credit Hero（credits）/ 学习时长（周榜/总榜）；我的排名固定底部
 *
 * 数据流：进入页面先用本地 study_stat + 云端签到数据上报自己的分数，
 * 再查询榜单（RLS 限定：只能更新自己的行，榜单全员可读）。
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { LeaderboardResult } from '../../../../core/net/api';
import { login } from '../../../../core/net/auth';
import { fetchCheckinDays, fetchLeaderboard, fetchStreakSummary, reportMyLeaderboardScores } from '../../../../core/net/cloudapi';
import { getSettings, getSession, isLoggedIn, updateSettings } from '../../../../core/storage/prefs';
import { studyStatStore } from '../../../../core/storage/entities';
import { dateKey, formatDuration } from '../../../../core/utils/date';

let offTheme: (() => void) | null = null;

interface RankRow {
  rank: number;
  nickname: string;
  scoreText: string;
  isMe: boolean;
}

function weekStartKey(): string {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 周一=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  return dateKey(monday.getTime());
}

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    loggedIn: false,
    rankVisible: true,
    tab: 'credit' as 'credit' | 'time',
    period: 'week' as 'week' | 'all',
    rows: [] as RankRow[],
    meText: '',
    loading: false,
    empty: false,
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle(), rankVisible: getSettings().rankVisible });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
  },

  onShow() {
    const loggedIn = isLoggedIn();
    this.setData({ loggedIn, rankVisible: getSettings().rankVisible });
    if (loggedIn) void this.load();
  },

  onUnload() {
    this.__destroyed = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  async load() {
    this.setData({ loading: true });
    try {
      await this.reportMyScores();
      const res = await fetchLeaderboard(this.data.tab, this.data.period);
      this.applyResult(res);
    } catch (e) {
      wx.showToast({ title: e instanceof Error ? e.message : '排行榜加载失败', icon: 'none' });
    } finally {
      if (!this.__destroyed) this.setData({ loading: false });
    }
  },

  /** 用本地学习统计 + 云端签到数据上报我的分数（尽力而为，失败不阻塞查询） */
  async reportMyScores(): Promise<void> {
    try {
      const today = dateKey();
      const weekStart = weekStartKey();
      const summary = await fetchStreakSummary();
      // 本周签到天数（周起点可能跨月，两个月都查）
      const months = Array.from(new Set([weekStart.slice(0, 7), today.slice(0, 7)]));
      let creditWeek = 0;
      for (const m of months) {
        const days = await fetchCheckinDays(m);
        creditWeek += days.filter((d) => d >= weekStart && d <= today).length;
      }
      // 学习分钟（本地 study_stat）
      let minutesAll = 0;
      let minutesWeek = 0;
      for (const st of studyStatStore.list()) {
        const minutes = ((st.practiceSeconds || 0) + (st.readingSeconds || 0)) / 60;
        minutesAll += minutes;
        if (st.date >= weekStart && st.date <= today) minutesWeek += minutes;
      }
      const sess = getSession();
      await reportMyLeaderboardScores({
        creditAll: summary.credits,
        creditWeek,
        minutesAll,
        minutesWeek,
        nickname: (sess && sess.nickname) || '',
        avatar: (sess && sess.avatar) || '',
        rankVisible: getSettings().rankVisible,
      });
    } catch {
      /* 上报失败不影响查看榜单 */
    }
  },

  applyResult(res: LeaderboardResult) {
    if (this.__destroyed) return;
    const isTime = this.data.tab === 'time';
    const rows: RankRow[] = (res.top || []).map((e) => ({
      rank: e.rank,
      nickname: e.nickname,
      scoreText: isTime ? formatDuration(e.score * 60) : `${e.score}`,
      isMe: !!e.isMe,
    }));
    const meText =
      res.me && res.me.rank > 0
        ? `第 ${res.me.rank} 名 · ${isTime ? formatDuration(res.me.score * 60) : `${res.me.score} credits`}`
        : '暂无排名（完成学习或签到后参与）';
    this.setData({ rows, meText, empty: rows.length === 0 });
  },

  onSwitchTab(e: WechatMiniprogram.TouchEvent) {
    const tab = String(e.currentTarget.dataset.tab) as 'credit' | 'time';
    if (tab === this.data.tab) return;
    this.setData({ tab });
    void this.load();
  },

  onSwitchPeriod(e: WechatMiniprogram.TouchEvent) {
    const period = String(e.currentTarget.dataset.period) as 'week' | 'all';
    if (period === this.data.period) return;
    this.setData({ period });
    void this.load();
  },

  async onToggleRank(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    const rankVisible = e.detail.checked;
    updateSettings({ rankVisible });
    this.setData({ rankVisible });
    try {
      await this.reportMyScores();
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '设置失败', icon: 'none' });
    }
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
