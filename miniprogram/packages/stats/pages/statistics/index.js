"use strict";
/**
 * 单篇统计：总览 / 近 14 天趋势 / 模式对比 / 薄弱环节 / 记忆热力图 / 练习历史
 * 入参：articleUuid
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const entities_1 = require("../../../../core/storage/entities");
const overview_1 = require("../../../../core/stats/overview");
const date_1 = require("../../../../core/utils/date");
const statisticsLogic_1 = require("./statisticsLogic");
let offTheme = null;
/** 页面级缓存（切换筛选 / 展开时复用，避免重复读盘） */
let recordsCache = [];
let expandedMap = {};
const FILTER_VALUES = ['ALL', 'SENTENCE', 'WORD', 'REVERSE'];
const FILTER_LABELS = ['全部', '句子', '字词', '默写'];
Page({
    data: {
        themeStyle: '',
        uuid: '',
        title: '',
        notFound: false,
        hasData: false,
        overview: [],
        trend: [],
        modes: [],
        weakness: [],
        heat: [],
        heatOverall: '—',
        legend: (0, statisticsLogic_1.heatLegend)(),
        history: [],
        filterIndex: 0,
        filterLabels: FILTER_LABELS,
    },
    onLoad(options) {
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        const uuid = options && options.articleUuid ? options.articleUuid : '';
        if (!uuid) {
            this.setData({ notFound: true });
            wx.showToast({ title: '缺少文章参数', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 900);
            return;
        }
        const article = entities_1.articleStore.find(uuid);
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
        const article = entities_1.articleStore.find(uuid);
        const content = article ? article.content : '';
        recordsCache = (0, entities_1.recordsOfArticle)(uuid);
        const stats = (0, overview_1.articleStats)(uuid);
        const overview = [
            { label: '总体正确率', value: stats.count > 0 ? `${Math.round(stats.accuracy * 100)}%` : '—' },
            { label: '练习次数', value: `${stats.count}` },
            { label: '历史最佳', value: stats.count > 0 ? `${Math.round(stats.bestAccuracy * 100)}%` : '—' },
            { label: '最近一次', value: stats.lastAt > 0 ? (0, date_1.formatFull)(stats.lastAt) : '—' },
            { label: '累计正确', value: `${stats.totalCorrect}` },
            { label: '学习天数', value: `${stats.streak}` },
        ];
        const heat = (0, statisticsLogic_1.buildHeat)(content, recordsCache);
        this.setData({
            hasData: recordsCache.length > 0,
            overview,
            trend: (0, statisticsLogic_1.buildTrend)(recordsCache),
            modes: (0, statisticsLogic_1.buildModes)(recordsCache),
            weakness: (0, statisticsLogic_1.buildWeakness)(recordsCache),
            heat: heat.cells,
            heatOverall: heat.overallErrorText,
        });
        this.rebuildHistory();
    },
    rebuildHistory() {
        const filter = FILTER_VALUES[this.data.filterIndex] || 'ALL';
        this.setData({ history: (0, statisticsLogic_1.buildHistory)(recordsCache, filter, expandedMap) });
    },
    onFilter(e) {
        const index = Number(e.currentTarget.dataset.index) || 0;
        if (index === this.data.filterIndex)
            return;
        this.setData({ filterIndex: index });
        this.rebuildHistory();
    },
    onToggleRow(e) {
        const uuid = String(e.currentTarget.dataset.uuid || '');
        if (!uuid)
            return;
        expandedMap = { ...expandedMap, [uuid]: !expandedMap[uuid] };
        this.rebuildHistory();
    },
    onTapPractice() {
        wx.navigateTo({ url: `/pages/practice/index?articleUuid=${this.data.uuid}` });
    },
});
