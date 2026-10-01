"use strict";
/**
 * 我的空间：云空间用量（已用 / 基础配额 / 总额）与明细
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const cloudapi_1 = require("../../../../core/net/cloudapi");
const auth_1 = require("../../../../core/net/auth");
const prefs_1 = require("../../../../core/storage/prefs");
let offTheme = null;
function fmtBytes(bytes) {
    if (bytes >= 1073741824)
        return `${(bytes / 1073741824).toFixed(2)}GB`;
    if (bytes >= 1048576)
        return `${(bytes / 1048576).toFixed(1)}MB`;
    return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}
function typeLabel(type) {
    if (type === 'document')
        return '文档';
    if (type === 'font')
        return '字体';
    return type;
}
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        loggedIn: false,
        usedText: '—',
        baseText: '—',
        totalText: '—',
        usedPercent: 0,
        items: [],
    },
    onLoad() {
        this.__destroyed = false;
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
    },
    onShow() {
        if (!(0, prefs_1.isLoggedIn)()) {
            this.setData({ loggedIn: false });
            return;
        }
        this.setData({ loggedIn: true });
        void this.load();
    },
    onUnload() {
        this.__destroyed = true;
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    async load() {
        try {
            const res = await (0, cloudapi_1.fetchSpaceUsage)();
            if (this.__destroyed)
                return;
            if (!res) {
                wx.showToast({ title: '用量加载失败', icon: 'none' });
                return;
            }
            const total = res.totalBytes || 1;
            const percent = Math.min(100, Math.round((res.usedBytes / total) * 100));
            this.setData({
                usedText: fmtBytes(res.usedBytes),
                baseText: fmtBytes(res.baseBytes),
                totalText: fmtBytes(res.totalBytes),
                usedPercent: percent,
                items: (res.items || []).map((it) => ({ typeLabel: typeLabel(it.type), sizeText: fmtBytes(it.size) })),
            });
        }
        catch (e) {
            wx.showToast({ title: e instanceof Error ? e.message : '用量加载失败', icon: 'none' });
        }
    },
    onGoLogin() {
        void (0, auth_1.login)()
            .then(() => {
            if (this.__destroyed)
                return;
            this.setData({ loggedIn: true });
            void this.load();
        })
            .catch((e) => wx.showToast({ title: e instanceof Error ? e.message : '登录失败', icon: 'none' }));
    },
});
