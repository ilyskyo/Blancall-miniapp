/**
 * 搜索：标题 / 正文 / 日期实时检索 + 命中高亮（分段 view，非 innerHTML）
 */

import { onThemeChange, themeStyle } from '../../core/theme/theme';
import { articleStore } from '../../core/storage/entities';
import { EVT, PageLike, bindPageEvents, unbindPageEvents } from '../../core/store/bus';
import { SearchResult, searchArticles } from './searchLogic';

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    keyword: '',
    results: [] as SearchResult[],
    resultCount: 0,
    searched: false,
  },

  onLoad() {
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
    bindPageEvents(this as unknown as PageLike, {
      [EVT.articlesChanged]: () => this.runSearch(this.data.keyword),
    });
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
    unbindPageEvents(this as unknown as PageLike);
  },

  onInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    this.runSearch(keyword);
  },

  onClear() {
    this.setData({ keyword: '' });
    this.runSearch('');
  },

  onConfirm() {
    this.runSearch(this.data.keyword);
  },

  runSearch(keyword: string) {
    try {
      const results = searchArticles(articleStore.list(), keyword);
      this.setData({ results, resultCount: results.length, searched: keyword.trim().length > 0 });
    } catch (e) {
      console.error('[search] 检索失败', e);
      wx.showToast({ title: '检索失败，请重试', icon: 'none' });
    }
  },

  onTapResult(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid || '');
    if (!uuid) return;
    wx.navigateTo({ url: `/pages/practice/index?articleUuid=${uuid}&mode=SENTENCE` });
  },
});