/**
 * 遮罩配置列表：新建（输入名称）/ 编辑 / 删除 / 选中生效（需 occlusion_custom 权益）
 * 选中项通过 selectMaskConfig 持久化，阅读模式读取 activeMaskConfig。
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import {
  MaskConfigEntity,
  articleStore,
  maskConfigStore,
  maskConfigsOfArticle,
  selectMaskConfig,
} from '../../../../core/storage/entities';
import { md5Hex } from '../../../../core/utils/digest';
import { uuidv7 } from '../../../../core/utils/uuid';
import { buildMaskRows, MaskRow } from './indexLogic';

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    articleUuid: '',
    articleTitle: '',
    /** 限时免费活动：展示灰色小按键 */
    rightText: '新建',
    configs: [] as MaskRow[],
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
    this.setData({ configs: buildMaskRows(maskConfigsOfArticle(this.data.articleUuid)) });
  },

  // ============================== 操作 ==============================

  onNew() {
    const article = articleStore.find(this.data.articleUuid);
    if (!article) return;
    wx.showModal({
      title: '新建遮罩配置',
      editable: true,
      placeholderText: '配置名称',
      content: '',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) {
          wx.showToast({ title: '请输入名称', icon: 'none' });
          return;
        }
        try {
          const list = maskConfigsOfArticle(this.data.articleUuid);
          const entity: MaskConfigEntity = {
            uuid: uuidv7(),
            articleUuid: this.data.articleUuid,
            name,
            createdAt: Date.now(),
            contentHash: md5Hex(article.content),
            spans: [],
            selected: list.length === 0,
            updatedAt: Date.now(),
          };
          maskConfigStore.upsert(entity);
          wx.navigateTo({
            url: `/packages/tools/pages/mask-edit/index?articleUuid=${this.data.articleUuid}&configId=${entity.uuid}`,
          });
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '创建失败', icon: 'none' });
        }
      },
    });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const configId = String(e.currentTarget.dataset.uuid);
    wx.navigateTo({
      url: `/packages/tools/pages/mask-edit/index?articleUuid=${this.data.articleUuid}&configId=${configId}`,
    });
  },

  onSelect(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    try {
      selectMaskConfig(this.data.articleUuid, uuid);
      this.reload();
      wx.showToast({ title: '已设为阅读生效配置', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '设置失败', icon: 'none' });
    }
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const config = maskConfigsOfArticle(this.data.articleUuid).find((c) => c.uuid === uuid);
    if (!config) return;
    wx.showModal({
      title: '删除配置',
      content: `确定删除「${config.name}」？该操作不可撤销。`,
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        try {
          maskConfigStore.remove(uuid);
          const rest = maskConfigsOfArticle(this.data.articleUuid);
          if (config.selected && rest.length > 0) selectMaskConfig(this.data.articleUuid, rest[0].uuid);
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