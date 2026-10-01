/**
 * 练习结果页：正确率总览 / 逐空对照 / AI 训练分析 / 分享图 / PDF 导出
 * 数据来自练习页交接的 lastResult（不落盘，避免污染存储）
 */

import { themeStyle, onThemeChange, currentTheme } from '../../core/theme/theme';
import { peekLastResult, errorTypeText } from '../../core/practice/lastResult';
import { MODE_LABEL } from '../practice/view';
import { checkAiGate, requestAnalysis, aiErrorText } from '../../core/ai';
import { formatMillis } from '../../core/utils/date';
import { articleStore } from '../../core/storage/entities';

let offTheme: (() => void) | null = null;
let analysisText = '';

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    title: '',
    modeLabel: '',
    accuracyPercent: 0,
    similarityText: '0%',
    durationText: '0秒',
    correctCount: 0,
    totalBlanks: 0,
    partial: false,
    blankResults: [] as Array<{ index: number; user: string; answer: string; correct: boolean; label: string }>,
    dictationRows: [] as Array<{ index: number; original: string; user: string; correct: boolean; label: string }>,
    analysis: '',
    analysisLoading: false,
    articleUuid: '',
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle() });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));

    const result = peekLastResult();
    if (!result) {
      wx.showToast({ title: '结果已失效，请重新练习', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    const { judgment, session, articleTitle, partial } = result;
    const percent = judgment.totalBlanks > 0 ? Math.round((judgment.correctCount / judgment.totalBlanks) * 100) : 0;

    const blankResults = session.blanks.map((b) => {
      const detail = judgment.perBlank[b.index];
      const correct = !!detail && (detail.result === 'CORRECT');
      return {
        index: b.index,
        user: (session.answers[b.index] || '').trim(),
        answer: b.answer,
        correct,
        label: detail ? errorTypeText(detail.result) : '未作答',
      };
    });

    const dictationRows: Array<{ index: number; original: string; user: string; correct: boolean; label: string }> = [];
    if (judgment.dictationDetail) {
      judgment.dictationDetail.sentences.forEach((s, i) => {
        dictationRows.push({
          index: i,
          original: s.matchedOriginal || (session.sentences[i] || ''),
          user: s.userText || '',
          correct: s.result === 'CORRECT',
          label: errorTypeText(s.result),
        });
      });
    }

    this.setData({
      title: articleTitle,
      modeLabel: MODE_LABEL[session.mode],
      accuracyPercent: percent,
      similarityText: `${Math.round((judgment.similarity || 0) * 100)}%`,
      durationText: formatMillis(judgment.durationMs),
      correctCount: judgment.correctCount,
      totalBlanks: judgment.totalBlanks,
      partial,
      blankResults,
      dictationRows,
      articleUuid: session.articleUuid,
    });

  },

  onUnload() {
    this.__destroyed = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  onShareAppMessage() {
    return {
      title: `我在 Blancall 练习「${this.data.title}」，正确率 ${this.data.accuracyPercent}%`,
      path: '/pages/home/index',
    };
  },

  onShareTimeline() {
    return { title: `Blancall：把文章变填空，真正记住东西（本次正确率 ${this.data.accuracyPercent}%）` };
  },

  // ============================== 操作 ==============================

  onContinue() {
    wx.redirectTo({ url: `/pages/practice/index?articleUuid=${this.data.articleUuid}&resume=1` });
  },

  onRetry() {
    wx.redirectTo({ url: `/pages/practice/index?articleUuid=${this.data.articleUuid}` });
  },

  onReadArticle() {
    wx.redirectTo({ url: `/pages/reader/index?articleUuid=${this.data.articleUuid}` });
  },

  async onAnalyze() {
    const gate = checkAiGate();
    if (!gate.allowed) {
      wx.showModal({
        title: 'AI 功能未上线',
        content: gate.reason || '',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }
    this.setData({ analysisLoading: true });
    try {
      const result = peekLastResult();
      const markdown = await requestAnalysis({
        title: this.data.title,
        mode: this.data.modeLabel,
        accuracy: this.data.accuracyPercent / 100,
        mistakes: (result ? result.judgment.mistakes : []).map((m) => ({
          correctAnswer: m.correctAnswer,
          userAnswer: m.userAnswer,
          errorType: m.errorType,
        })),
        weakHints: result ? result.session.weakHints : 0,
        strongHints: result ? result.session.strongHints : 0,
      });
      analysisText = markdown;
      if (this.__destroyed) return;
      wx.setStorageSync('last_analysis', { text: markdown, title: this.data.title, at: Date.now() });
      this.setData({
        analysis: markdown,
        analysisLoading: false,
      });
    } catch (e) {
      if (!this.__destroyed) this.setData({ analysisLoading: false });
      wx.showToast({ title: aiErrorText(e), icon: 'none' });
    }
  },

  // ============================== 分享图 ==============================

  async onShareImage() {
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
      // 生成失败给出重试入口（而非只有一句 toast）
      wx.showModal({
        title: '生成分享图失败',
        content: (e as Error).message || '请稍后重试',
        confirmText: '重试',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) void this.onShareImage();
        },
      });
    }
  },

  drawShareImage(): Promise<string> {
    const theme = currentTheme();
    return new Promise((resolve, reject) => {
      // 页面内查询（Page 场景不需要 .in(this)）
      const query = wx.createSelectorQuery();
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
          ctx.fillStyle = theme.dark ? '#000000' : '#F7F5F1';
          ctx.fillRect(0, 0, 1080, 1440);

          // 标题
          ctx.fillStyle = theme.text;
          ctx.font = 'bold 56px sans-serif';
          ctx.fillText(this.data.title.slice(0, 16), 80, 150);
          // 正确率
          ctx.fillStyle = theme.accent;
          ctx.font = 'bold 200px sans-serif';
          ctx.fillText(`${this.data.accuracyPercent}%`, 80, 420);
          ctx.fillStyle = theme.textSecondary;
          ctx.font = '44px sans-serif';
          ctx.fillText(`正确 ${this.data.correctCount}/${this.data.totalBlanks} · ${this.data.modeLabel}`, 80, 500);

          // 挖空正文（最多 12 行）
          const article = articleStore.find(this.data.articleUuid);
          if (article) {
            ctx.fillStyle = theme.text;
            ctx.font = '40px sans-serif';
            let y = 620;
            const maxWidth = 920;
            let line = '';
            for (const ch of article.content.replace(/\n+/g, ' ')) {
              if (ctx.measureText(line + ch).width > maxWidth) {
                ctx.fillText(line, 80, y);
                y += 62;
                line = ch;
                if (y > 1280) break;
              } else {
                line += ch;
              }
            }
            if (y <= 1280 && line) ctx.fillText(line, 80, y);
          }

          // 品牌底栏
          ctx.fillStyle = theme.textSecondary;
          ctx.font = '36px sans-serif';
          ctx.fillText('Blancall · 不是清空，是召回', 80, 1380);

          wx.canvasToTempFilePath({
              canvas,
              x: 0,
              y: 0,
              width: 1080,
              height: 1440,
              destWidth: 1080,
              destHeight: 1440,
              success: (r) => resolve(r.tempFilePath),
              fail: (e) => reject(e),
            });
        });
    });
  },

  // ============================== PDF 导出 ==============================

  async onExportPdf() {
    // 导出依赖服务端渲染，当前未上线
    wx.showModal({
      title: '即将上线',
      content: 'PDF 导出功能即将上线，敬请期待',
      showCancel: false,
      confirmText: '我知道了',
    });
  },
});

// ============================== 辅助 ==============================

export const _analysisCache = (): string => analysisText;