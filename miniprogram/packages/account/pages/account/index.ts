/**
 * 账户中心：登录 / 资料（头像昵称、上榜开关）/ 云能力入口 / 签到排行 / 退出 / 注销
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import {
  currentUser,
  entitlementsSnapshot,
  loadEntitlements,
  login,
  logout,
} from '../../../../core/net/auth';
import { deleteMyAccount, upsertMyProfile } from '../../../../core/net/cloudapi';
import { getSettings, getSession, setSession, updateSettings } from '../../../../core/storage/prefs';
import { errorText, uploadAvatarAndSave } from '../../../../core/upload';
import { emit, EVT } from '../../../../core/store/bus';

let offTheme: (() => void) | null = null;

/** 字节 → 展示文案 */
function fmtBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)}GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    loggedIn: false,
    nickname: '',
    avatar: '',
    avatarText: '登',
    rankVisible: true,
    spaceText: '—',
    credits: 0,
    streak: 0,
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
  },

  onShow() {
    this.refresh();
    void loadEntitlements()
      .then(() => this.refresh())
      .catch(() => this.refresh());
  },

  onUnload() {
    this.__destroyed = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  /** 依据本地会话与权益快照刷新页面 */
  refresh() {
    if (this.__destroyed) return;
    const user = currentUser();
    const ent = entitlementsSnapshot();
    const nickname = user ? user.nickname || '' : '';
    this.setData({
      loggedIn: !!user,
      nickname,
      avatar: user ? user.avatar : '',
      avatarText: nickname ? nickname.slice(0, 1) : '登',
      rankVisible: getSettings().rankVisible,
      spaceText: ent ? `${fmtBytes(ent.space.usedBytes)} / ${fmtBytes(ent.space.totalBytes)}` : '—',
      credits: ent ? ent.credits : 0,
      streak: ent ? ent.streak.current : 0,
    });
  },

  // ---------- 登录 / 退出 / 注销 ----------

  async onLogin() {
    try {
      wx.showLoading({ title: '登录中', mask: true });
      await login();
      await loadEntitlements(true).catch(() => undefined);
      emit(EVT.entitlementsChanged);
      this.refresh();
      wx.showToast({ title: '登录成功', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e instanceof Error ? e.message : '登录失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后云同步、上传与 AI 功能不可用，本地数据仍保留。确定退出？',
      success: (res) => {
        if (!res.confirm) return;
        void logout()
          .then(() => {
            emit(EVT.entitlementsChanged);
            this.refresh();
            wx.showToast({ title: '已退出登录', icon: 'none' });
          })
          .catch((e: unknown) => wx.showToast({ title: e instanceof Error ? e.message : '退出失败', icon: 'none' }));
      },
    });
  },

  onDeleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销将永久删除云端账号与全部云端数据，且不可恢复。确定继续？',
      confirmText: '继续',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        wx.showModal({
          title: '最终确认',
          editable: true,
          placeholderText: '请输入「注销」以确认',
          success: (r2) => {
            if (!r2.confirm) return;
            if ((r2.content || '').trim() !== '注销') {
              wx.showToast({ title: '输入不匹配，已取消', icon: 'none' });
              return;
            }
            void this.doDeleteAccount();
          },
        });
      },
    });
  },

  async doDeleteAccount() {
    try {
      wx.showLoading({ title: '注销中', mask: true });
      await deleteMyAccount();
      // 云端已删除（deleteMyAccount 内部已登出）：清除本地权益缓存
      await logout();
      emit(EVT.entitlementsChanged);
      this.refresh();
      wx.hideLoading();
      wx.showModal({
        title: '账号已注销',
        content: '云端账号与数据已删除。本地学习数据仍保留在本机，如需清除可前往「设置 → 清空本地数据」。',
        showCancel: false,
        confirmText: '我知道了',
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e instanceof Error ? e.message : '注销失败，请稍后重试', icon: 'none' });
    }
  },

  // ---------- 资料 ----------

  async onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;
    try {
      wx.showLoading({ title: '上传中', mask: true });
      // 临时路径下次启动即失效：先转存到对象存储，再把 URL 写入资料
      const avatar = await uploadAvatarAndSave(avatarUrl);
      if (this.__destroyed) return;
      this.setData({ avatar });
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: errorText(err), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onNicknameChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const nickname = (e.detail.value || '').trim();
    if (!nickname || nickname === this.data.nickname) return;
    try {
      const { profile } = await upsertMyProfile({ nickname });
      if (this.__destroyed) return;
      const finalName = (profile && profile.nickname) || nickname;
      const s = getSession();
      if (s) setSession({ ...s, nickname: finalName });
      this.setData({ nickname: finalName, avatarText: finalName.slice(0, 1) || '登' });
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '昵称更新失败', icon: 'none' });
    }
  },

  async onToggleRank(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    const rankVisible = e.detail.checked;
    updateSettings({ rankVisible });
    this.setData({ rankVisible });
    try {
      await upsertMyProfile({ rankVisible });
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '设置失败', icon: 'none' });
    }
  },

  // ---------- 入口跳转 ----------

  onTapUploads() {
    wx.navigateTo({ url: '/packages/account/pages/uploads/index' });
  },

  onTapFonts() {
    wx.navigateTo({ url: '/packages/account/pages/fonts/index' });
  },

  onTapSpace() {
    wx.navigateTo({ url: '/packages/account/pages/space/index' });
  },

  onTapOrders() {
    wx.navigateTo({ url: '/packages/account/pages/orders/index' });
  },

  onTapCheckin() {
    wx.navigateTo({ url: '/packages/account/pages/checkin/index' });
  },

  onTapLeaderboard() {
    wx.navigateTo({ url: '/packages/account/pages/leaderboard/index' });
  },
});