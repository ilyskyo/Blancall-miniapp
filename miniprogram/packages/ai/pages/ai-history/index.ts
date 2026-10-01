/**
 * AI 历史：训练分析（本地 ai_analysis_history）+ 对话历史（本地会话）
 * 支持单条删除、点击查看（分析纯文本 / 对话续聊）
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { formatFull } from '../../../../core/utils/date';
import { listSessions, removeSession } from '../ai/indexLogic';
import { AnalysisItem, loadAnalyses, removeAnalysis } from './indexLogic';

let offTheme: (() => void) | null = null;

interface AnalysisRow {
  at: number;
  title: string;
  timeText: string;
  preview: string;
}

interface SessionRow {
  id: string;
  title: string;
  timeText: string;
  preview: string;
  count: number;
}

function toAnalysisRow(item: AnalysisItem): AnalysisRow {
  return {
    at: item.at,
    title: item.title || '训练分析',
    timeText: formatFull(item.at),
    preview: (item.text || '').replace(/\s+/g, ' ').slice(0, 50),
  };
}

Page({
  data: {
    themeStyle: '',
    analyses: [] as AnalysisRow[],
    sessions: [] as SessionRow[],
    // 分析详情
    detailVisible: false,
    detailTitle: '',
    detailText: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ themeStyle: themeStyle() });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
    void query;
    this.reload();
  },

  onShow() {
    this.reload();
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  reload() {
    this.setData({
      analyses: loadAnalyses().map(toAnalysisRow),
      sessions: listSessions().map((s) => ({
        id: s.id,
        title: s.title || 'AI 对话',
        timeText: formatFull(s.updatedAt),
        preview: (s.messages.find((m) => m.role === 'user')?.content || '').replace(/\s+/g, ' ').slice(0, 50),
        count: s.messages.length,
      })),
    });
  },

  // ============================== 训练分析 ==============================

  onOpenAnalysis(e: WechatMiniprogram.TouchEvent) {
    const at = Number(e.currentTarget.dataset.at);
    const item = loadAnalyses().find((it) => it.at === at);
    if (!item) return;
    this.setData({ detailVisible: true, detailTitle: item.title || '训练分析', detailText: item.text || '' });
  },

  onCloseDetail() {
    this.setData({ detailVisible: false });
  },

  onDeleteAnalysis(e: WechatMiniprogram.TouchEvent) {
    const at = Number(e.currentTarget.dataset.at);
    wx.showModal({
      title: '删除分析',
      content: '确定删除这条训练分析？',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        removeAnalysis(at);
        this.reload();
        wx.showToast({ title: '已删除', icon: 'none' });
      },
    });
  },

  // ============================== 对话历史 ==============================

  onOpenSession(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    wx.navigateTo({ url: `/packages/ai/pages/ai/index?sessionId=${id}` });
  },

  onDeleteSession(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除会话',
      content: '确定删除这段对话？',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        removeSession(id);
        this.reload();
        wx.showToast({ title: '已删除', icon: 'none' });
      },
    });
  },
});