"use strict";
/**
 * 自定义 tabBar（液态玻璃降级实现 + 条件展示「素材库」）
 * 素材库 tab 仅在设置中启用至少一个内置库后显示（与原产品一致）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const prefs_1 = require("../core/storage/prefs");
const ALL_TABS = [
    { path: '/pages/home/index', text: '首页', icon: '🏠', key: 'home' },
    { path: '/pages/list/index', text: '我的文章', icon: '📄', key: 'list' },
    { path: '/pages/overview/index', text: '数据', icon: '📊', key: 'overview' },
    { path: '/pages/library/index', text: '素材库', icon: '📚', key: 'library' },
];
/** 设置变更解绑函数（模块级，避免污染组件实例类型） */
let offSettings = null;
Component({
    data: {
        selected: 0,
        tabs: ALL_TABS.slice(0, 3),
    },
    lifetimes: {
        attached() {
            this.refreshTabs();
            if (offSettings)
                offSettings();
            offSettings = (0, prefs_1.onSettingsChange)(() => this.refreshTabs());
        },
        detached() {
            if (offSettings) {
                offSettings();
                offSettings = null;
            }
        },
    },
    methods: {
        refreshTabs() {
            const settings = (0, prefs_1.getSettings)();
            const showLibrary = (settings.builtInLibraryKeys || []).length > 0;
            const tabs = showLibrary ? ALL_TABS : ALL_TABS.slice(0, 3);
            // 素材库被关闭时：若用户仍停留在素材库页，回退首页；否则钳制选中态到有效范围
            // （否则该页无高亮、点击也无响应）
            if (!showLibrary) {
                const pages = getCurrentPages();
                const top = pages.length > 0 ? pages[pages.length - 1] : null;
                const route = top ? top.route || '' : '';
                if (route.indexOf('pages/library/index') >= 0) {
                    wx.switchTab({ url: '/pages/home/index' });
                }
            }
            this.setData({
                tabs,
                selected: Math.min(this.data.selected, tabs.length - 1),
            });
        },
        onTab(e) {
            const index = Number(e.currentTarget.dataset.index);
            const tab = this.data.tabs[index];
            if (!tab)
                return;
            if (this.data.selected === index)
                return;
            wx.switchTab({ url: tab.path });
            this.setData({ selected: index });
        },
    },
});
