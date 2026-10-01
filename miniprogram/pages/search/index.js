"use strict";
/**
 * 搜索：标题 / 正文 / 日期实时检索 + 命中高亮（分段 view，非 innerHTML）
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
const entities_1 = require("../../core/storage/entities");
const bus_1 = require("../../core/store/bus");
const searchLogic_1 = require("./searchLogic");
let offTheme = null;
Page({
    data: {
        themeStyle: '',
        keyword: '',
        results: [],
        resultCount: 0,
        searched: false,
    },
    onLoad() {
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        (0, bus_1.bindPageEvents)(this, {
            [bus_1.EVT.articlesChanged]: () => this.runSearch(this.data.keyword),
        });
    },
    onUnload() {
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
        (0, bus_1.unbindPageEvents)(this);
    },
    onInput(e) {
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
    runSearch(keyword) {
        try {
            const results = (0, searchLogic_1.searchArticles)(entities_1.articleStore.list(), keyword);
            this.setData({ results, resultCount: results.length, searched: keyword.trim().length > 0 });
        }
        catch (e) {
            console.error('[search] 检索失败', e);
            wx.showToast({ title: '检索失败，请重试', icon: 'none' });
        }
    },
    onTapResult(e) {
        const uuid = String(e.currentTarget.dataset.uuid || '');
        if (!uuid)
            return;
        wx.navigateTo({ url: `/pages/practice/index?articleUuid=${uuid}&mode=SENTENCE` });
    },
});
