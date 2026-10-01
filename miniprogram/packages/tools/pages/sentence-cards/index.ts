/**
 * 每日句卡：展示今日句卡（无则按轮转规则抽取并保存）、复制、生成分享图、换一句、去练习
 */

import { currentTheme, onThemeChange, themeStyle } from '../../../../core/theme/theme';
import {
  allFsrs,
  articleStore,
  getSentenceCard,
  saveSentenceCard,
} from '../../../../core/storage/entities';
import { pickNextCard, toCardPayload } from './indexLogic';
import { dateKey } from '../../../../core/utils/date';

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    hasCard: false,
    dateText: '',
    text: '',
    title: '',
    articleUuid: '',
    emptyText: '还没有文章，先导入一篇文章吧',
  },

  onLoad() {
    this.setData({ themeStyle: themeStyle() });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
    this.loadCard();
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  onShareAppMessage() {
    return { title: `每日一句 · ${this.data.text.slice(0, 20)}`, path: '/pages/home/index' };
  },

  onShareTimeline() {
    return { title: `Blancall 每日一句：${this.data.text.slice(0, 30)}` };
  },

  /** 读取今日句卡；无则抽新句并保存 */
  loadCard() {
    const existing = getSentenceCard(dateKey());
    if (existing && existing.text) {
      this.showCard(existing.text, existing.title, existing.articleUuid, existing.date);
      return;
    }
    this.buildCard('');
  },

  /** 抽一句并保存（excludeKey 用于「换一句」避免重复） */
  buildCard(excludeKey: string) {
    const articles = articleStore.list();
    if (articles.length === 0) {
      this.setData({ hasCard: false, emptyText: '还没有文章，先导入一篇文章吧' });
      return;
    }
    const pick = pickNextCard(articles, allFsrs(), excludeKey);
    if (!pick) {
      this.setData({ hasCard: false, emptyText: '暂无可用于句卡的句子' });
      return;
    }
    const payload = toCardPayload(pick, articles, dateKey());
    saveSentenceCard(payload);
    this.showCard(payload.text, payload.title, payload.articleUuid, payload.date);
  },

  showCard(text: string, title: string, articleUuid: string, date: string) {
    this.setData({
      hasCard: true,
      text,
      title: title || '未命名',
      articleUuid,
      dateText: date,
    });
  },

  // ============================== 操作 ==============================

  onCopy() {
    if (!this.data.text) return;
    wx.setClipboardData({
      data: this.data.text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
    });
  },

  onChange() {
    this.buildCard(this.data.text ? this.data.text : '');
    wx.showToast({ title: '已换一句', icon: 'none' });
  },

  onGoPractice() {
    if (!this.data.articleUuid) return;
    wx.navigateTo({ url: `/pages/practice/index?articleUuid=${this.data.articleUuid}` });
  },

  onGoImport() {
    wx.navigateTo({ url: '/pages/import/index' });
  },

  // ============================== 分享图 ==============================

  async onShareImage() {
    if (!this.data.hasCard) return;
    wx.showLoading({ title: '生成中…' });
    try {
      const path = await this.drawShareImage();
      wx.hideLoading();
      wx.previewImage({ urls: [path] });
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: () => wx.showToast({ title: '可长按图片保存', icon: 'none' }),
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  },

  drawShareImage(): Promise<string> {
    const theme = currentTheme();
    const title = this.data.title;
    const body = this.data.text;
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          const canvas = item && (item.node as WechatMiniprogram.Canvas);
          if (!canvas) {
            reject(new Error('canvas 不存在'));
            return;
          }
          const ctx = canvas.getContext('2d');
          canvas.width = 1080;
          canvas.height = 1440;
          ctx.fillStyle = theme.dark ? '#000000' : theme.bg;
          ctx.fillRect(0, 0, 1080, 1440);

          // 顶部小标题
          ctx.fillStyle = theme.accent;
          ctx.font = '40px sans-serif';
          ctx.fillText('每日一句', 80, 160);

          // 正文（按宽度折行）
          ctx.fillStyle = theme.text;
          ctx.font = 'bold 56px sans-serif';
          const maxWidth = 920;
          let y = 340;
          let line = '';
          for (const ch of body) {
            if (ctx.measureText(line + ch).width > maxWidth) {
              ctx.fillText(line, 80, y);
              y += 86;
              line = ch;
              if (y > 1080) break;
            } else {
              line += ch;
            }
          }
          if (y <= 1080 && line) ctx.fillText(line, 80, y);

          // 出处
          ctx.fillStyle = theme.textSecondary;
          ctx.font = '44px sans-serif';
          ctx.fillText(`—— ${title.slice(0, 20)}`, 80, y + 120);

          // 品牌底栏
          ctx.fillStyle = theme.textSecondary;
          ctx.font = '38px sans-serif';
          ctx.fillText('Blancall · 不是清空，是召回', 80, 1380);

          wx.canvasToTempFilePath(
            {
              canvas,
              x: 0,
              y: 0,
              width: 1080,
              height: 1440,
              destWidth: 1080,
              destHeight: 1440,
              success: (r) => resolve(r.tempFilePath),
              fail: (e) => reject(e),
            },
            this as unknown as WechatMiniprogram.Component.TrivialInstance
          );
        });
    });
  },
});