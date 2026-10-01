/**
 * 素材库（tabBar 第 4 项）：内置库列表 → 目录 → 正文 → 导入到背诵
 * 首次进入需确认免责声明；目录/正文有本地缓存，离线可用。
 */

import { onThemeChange, themeStyle } from '../../core/theme/theme';
import {
  buildCards,
  disclaimerSeen,
  importToArticle,
  LIBRARY_DISCLAIMER,
  LibraryCard,
  LibraryItem,
  LibraryText,
  loadIndex,
  loadText,
  markDisclaimerSeen,
  setLibraryEnabled,
} from './indexLogic';

type Mode = 'list' | 'index' | 'detail';

let offTheme: (() => void) | null = null;

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    disclaimerVisible: false,
    disclaimerText: LIBRARY_DISCLAIMER,

    mode: 'list' as Mode,
    cards: [] as LibraryCard[],
    anyEnabled: false,
    loading: false,
    offline: false,

    indexItems: [] as LibraryItem[],
    current: null as LibraryText | null,
    currentNo: 0,
    currentTitle: '',
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style) => this.setData({ themeStyle: style }));
    // 首次进入显示免责声明
    this.setData({ disclaimerVisible: !disclaimerSeen() });
    this.refreshCards();
  },

  onShow() {
    const tb = this.getTabBar && this.getTabBar();
    if (tb) tb.setData({ selected: 3 });
    this.refreshCards();
  },

  onUnload() {
    this.__destroyed = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  refreshCards() {
    const cards = buildCards();
    this.setData({ cards, anyEnabled: cards.some((c) => c.enabled) });
  },

  // ---------- 免责声明 ----------

  onConfirmDisclaimer() {
    markDisclaimerSeen();
    this.setData({ disclaimerVisible: false });
  },

  // ---------- 列表操作 ----------

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key);
    const card = this.data.cards.find((c) => c.key === key);
    if (!card) return;
    const next = !card.enabled;
    setLibraryEnabled(key, next);
    this.refreshCards();
    wx.showToast({ title: next ? '已启用素材库' : '已关闭素材库', icon: 'none' });
  },

  onGoSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  // ---------- 目录 / 正文 ----------

  async onOpenLibrary() {
    if (!this.data.anyEnabled) {
      wx.showToast({ title: '请先在设置中启用素材库', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const items = await loadIndex(true);
      if (this.__destroyed) return;
      this.setData({ indexItems: items, mode: 'index', offline: false });
    } catch {
      const cached = await loadIndex(false).catch(() => null);
      if (this.__destroyed) return;
      if (cached && cached.length > 0) {
        this.setData({ indexItems: cached, mode: 'index', offline: true });
        wx.showToast({ title: '当前离线，显示本地缓存', icon: 'none' });
      } else {
        wx.showToast({ title: '网络异常，且无本地缓存', icon: 'none' });
      }
    } finally {
      if (!this.__destroyed) this.setData({ loading: false });
    }
  },

  async onOpenText(e: WechatMiniprogram.TouchEvent) {
    const no = Number(e.currentTarget.dataset.no) || 0;
    if (!no) return;
    this.setData({ loading: true });
    try {
      const text = await loadText(no, true);
      if (this.__destroyed) return;
      this.setData({ current: text, currentNo: text.no, currentTitle: text.title, mode: 'detail', offline: false });
    } catch {
      const cached = await loadText(no, false).catch(() => null);
      if (this.__destroyed) return;
      if (cached) {
        this.setData({ current: cached, currentNo: cached.no, currentTitle: cached.title, mode: 'detail', offline: true });
        wx.showToast({ title: '当前离线，显示本地缓存', icon: 'none' });
      } else {
        wx.showToast({ title: '网络异常，且无本地缓存', icon: 'none' });
      }
    } finally {
      if (!this.__destroyed) this.setData({ loading: false });
    }
  },

  onImport() {
    const text = this.data.current;
    if (!text) return;
    try {
      const res = importToArticle(text);
      wx.showModal({
        title: res.created ? '已导入到背诵' : '该文章已存在',
        content: res.created ? '已加入「我的文章」，是否立即去练习？' : '同名同内容文章已存在，可直接去练习。',
        confirmText: '去练习',
        cancelText: '知道了',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: `/pages/practice/index?articleUuid=${res.articleUuid}` });
        },
      });
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '导入失败', icon: 'none' });
    }
  },

  // ---------- 页内返回 ----------

  onBackInPage() {
    if (this.data.mode === 'detail') this.setData({ mode: 'index', current: null });
    else this.setData({ mode: 'list' });
  },
});