/**
 * 我的空间：云空间用量（已用 / 基础配额 / 总额）与明细
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { SpaceUsage } from '../../../../core/net/api';
import { fetchSpaceUsage } from '../../../../core/net/cloudapi';
import { login } from '../../../../core/net/auth';
import { isLoggedIn } from '../../../../core/storage/prefs';

let offTheme: (() => void) | null = null;

function fmtBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)}GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

function typeLabel(type: string): string {
  if (type === 'document') return '文档';
  if (type === 'font') return '字体';
  return type;
}

interface SpaceItem {
  typeLabel: string;
  sizeText: string;
}

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    loggedIn: false,
    usedText: '—',
    baseText: '—',
    totalText: '—',
    usedPercent: 0,
    items: [] as SpaceItem[],
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
  },

  onShow() {
    if (!isLoggedIn()) {
      this.setData({ loggedIn: false });
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
    try {
      const res: SpaceUsage | null = await fetchSpaceUsage();
      if (this.__destroyed) return;
      if (!res) {
        wx.showToast({ title: '用量加载失败', icon: 'none' });
        return;
      }
      const total = res.totalBytes || 1;
      const percent = Math.min(100, Math.round((res.usedBytes / total) * 100));
      this.setData({
        usedText: fmtBytes(res.usedBytes),
        baseText: fmtBytes(res.baseBytes),
        totalText: fmtBytes(res.totalBytes),
        usedPercent: percent,
        items: (res.items || []).map((it) => ({ typeLabel: typeLabel(it.type), sizeText: fmtBytes(it.size) })),
      });
    } catch (e) {
      wx.showToast({ title: e instanceof Error ? e.message : '用量加载失败', icon: 'none' });
    }
  },

  onGoLogin() {
    void login()
      .then(() => {
        if (this.__destroyed) return;
        this.setData({ loggedIn: true });
        void this.load();
      })
      .catch((e: unknown) => wx.showToast({ title: e instanceof Error ? e.message : '登录失败', icon: 'none' }));
  },
});
