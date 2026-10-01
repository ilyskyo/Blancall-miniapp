/**
 * 自定义挖空配置列表：新建 / 编辑 / 删除 / 选中为当前（需 cloze_custom 权益）
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { articleStore, customClozeOfArticle, customClozeStore } from '../../../../core/storage/entities';
import { activeConfigKey, buildConfigRows, ConfigRow } from './indexLogic';

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    articleUuid: '',
    articleTitle: '',
    /** 限时免费活动：展示灰色小按键 */
    rightText: '新建',
    configs: [] as ConfigRow[],
    activeUuid: '',
  },

  onLoad(query: Record<string, string>) {
    const articleUuid = query.articleUuid || '';
    const article = articleStore.find(articleUuid);
    if (!article) {
      wx.showToast({ title: '文章不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ themeStyle: themeStyle(), articleUuid, articleTitle: article.title });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
    this.reload();
  },

  onShow() {
    if (this.data.articleUuid) this.reload();
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  reload() {
    const articleUuid = this.data.articleUuid;
    const activeUuid = this.activeUuidOf(articleUuid);
    this.setData({
      activeUuid,
      configs: buildConfigRows(customClozeOfArticle(articleUuid), activeUuid),
    });
  },

  activeUuidOf(articleUuid: string): string {
    try {
      const v = wx.getStorageSync(activeConfigKey(articleUuid));
      return typeof v === 'string' ? v : '';
    } catch {
      return '';
    }
  },

  // ============================== 操作 ==============================

  onNew() {
    wx.navigateTo({ url: `/packages/tools/pages/custom-cloze-edit/index?articleUuid=${this.data.articleUuid}` });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const configId = String(e.currentTarget.dataset.uuid);
    wx.navigateTo({
      url: `/packages/tools/pages/custom-cloze-edit/index?articleUuid=${this.data.articleUuid}&configId=${configId}`,
    });
  },

  onSelect(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    try {
      wx.setStorageSync(activeConfigKey(this.data.articleUuid), uuid);
      this.reload();
      wx.showToast({ title: '已设为当前配置', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '设置失败', icon: 'none' });
    }
  },

  onPractice(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const config = customClozeOfArticle(this.data.articleUuid).find((c) => c.uuid === uuid);
    const mode = config ? config.mode : 'SENTENCE';
    wx.navigateTo({
      url: `/pages/practice/index?articleUuid=${this.data.articleUuid}&configUuid=${uuid}&mode=${mode}`,
    });
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const config = customClozeOfArticle(this.data.articleUuid).find((c) => c.uuid === uuid);
    if (!config) return;
    wx.showModal({
      title: '删除配置',
      content: `确定删除「${config.name}」？该操作不可撤销。`,
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        try {
          customClozeStore.remove(uuid);
          if (this.activeUuidOf(this.data.articleUuid) === uuid) {
            wx.setStorageSync(activeConfigKey(this.data.articleUuid), '');
          }
          this.reload();
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' });
        }
      },
    });
  },

  onShowLock() {
    this.setData({ lockVisible: true });
  },

  onLockClose() {
    this.setData({ lockVisible: false });
  },
});