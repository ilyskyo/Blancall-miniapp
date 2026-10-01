/**
 * 单篇统计：总览 / 近 14 天趋势 / 模式对比 / 薄弱环节 / 记忆热力图 / 练习历史
 * 入参：articleUuid
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { articleStore, recordsOfArticle } from '../../../../core/storage/entities';
import { PracticeRecordEntity } from '../../../../core/algorithms/types';
import { articleStats } from '../../../../core/stats/overview';
import { formatFull } from '../../../../core/utils/date';
import {
  HeatCell,
  HeatResult,
  HistoryRow,
  ModeRow,
  TrendBar,
  WeakRow,
  buildHeat,
  buildHistory,
  buildModes,
  buildTrend,
  buildWeakness,
  heatLegend,
} from './statisticsLogic';

let offTheme: (() => void) | null = null;

/** 页面级缓存（切换筛选 / 展开时复用，避免重复读盘） */
let recordsCache: PracticeRecordEntity[] = [];
let expandedMap: Record<string, boolean> = {};

const FILTER_VALUES = ['ALL', 'SENTENCE', 'WORD', 'REVERSE'];
const FILTER_LABELS = ['全部', '句子', '字词', '默写'];

interface OverviewRow {
  label: string;
  value: string;
}

Page({
  data: {
    themeStyle: '',
    uuid: '',
    title: '',
    notFound: false,
    hasData: false,
    overview: [] as OverviewRow[],
    trend: [] as TrendBar[],
    modes: [] as ModeRow[],
    weakness: [] as WeakRow[],
    heat: [] as HeatCell[],
    heatOverall: '—',
    legend: heatLegend(),
    history: [] as HistoryRow[],
    filterIndex: 0,
    filterLabels: FILTER_LABELS,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));

    const uuid = options && options.articleUuid ? options.articleUuid : '';
    if (!uuid) {
      this.setData({ notFound: true });
      wx.showToast({ title: '缺少文章参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    const article = articleStore.find(uuid);
    this.setData({ uuid, title: article ? article.title : '已删除的文章' });
    this.load();
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  load() {
    const uuid = this.data.uuid;
    const article = articleStore.find(uuid);
    const content = article ? article.content : '';
    recordsCache = recordsOfArticle(uuid);

    const stats = articleStats(uuid);
    const overview: OverviewRow[] = [
      { label: '总体正确率', value: stats.count > 0 ? `${Math.round(stats.accuracy * 100)}%` : '—' },
      { label: '练习次数', value: `${stats.count}` },
      { label: '历史最佳', value: stats.count > 0 ? `${Math.round(stats.bestAccuracy * 100)}%` : '—' },
      { label: '最近一次', value: stats.lastAt > 0 ? formatFull(stats.lastAt) : '—' },
      { label: '累计正确', value: `${stats.totalCorrect}` },
      { label: '学习天数', value: `${stats.streak}` },
    ];

    const heat: HeatResult = buildHeat(content, recordsCache);

    this.setData({
      hasData: recordsCache.length > 0,
      overview,
      trend: buildTrend(recordsCache),
      modes: buildModes(recordsCache),
      weakness: buildWeakness(recordsCache),
      heat: heat.cells,
      heatOverall: heat.overallErrorText,
    });
    this.rebuildHistory();
  },

  rebuildHistory() {
    const filter = FILTER_VALUES[this.data.filterIndex] || 'ALL';
    this.setData({ history: buildHistory(recordsCache, filter, expandedMap) });
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    if (index === this.data.filterIndex) return;
    this.setData({ filterIndex: index });
    this.rebuildHistory();
  },

  onToggleRow(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid || '');
    if (!uuid) return;
    expandedMap = { ...expandedMap, [uuid]: !expandedMap[uuid] };
    this.rebuildHistory();
  },

  onTapPractice() {
    wx.navigateTo({ url: `/pages/practice/index?articleUuid=${this.data.uuid}` });
  },
});