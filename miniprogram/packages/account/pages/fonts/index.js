"use strict";
/**
 * 我的字体：上传 / 列表 / 删除 / 预览 / 设为阅读字体
 * 仅个人使用，请勿上传未获授权的字体。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const auth_1 = require("../../../../core/net/auth");
const prefs_1 = require("../../../../core/storage/prefs");
const upload_1 = require("../../../../core/upload");
let offTheme = null;
const SAMPLE_TEXT = 'Blancall 让背诵更高效：野芳发而幽香，佳木秀而繁阴。';
const PREVIEW_FAMILY = 'BlancallPreview';
function fmtSize(bytes) {
    if (!bytes)
        return '—';
    if (bytes >= 1048576)
        return `${(bytes / 1048576).toFixed(1)}MB`;
    return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        loggedIn: false,
        loading: false,
        uploading: false,
        fonts: [],
        previewFamily: PREVIEW_FAMILY,
        previewText: SAMPLE_TEXT,
        previewingId: '',
    },
    onLoad() {
        this.__destroyed = false;
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
    },
    onShow() {
        const loggedIn = (0, prefs_1.isLoggedIn)();
        this.setData({ loggedIn });
        if (loggedIn)
            void this.load();
        else
            this.setData({ fonts: [] });
    },
    onUnload() {
        this.__destroyed = true;
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    async load() {
        this.setData({ loading: true });
        try {
            const list = await (0, upload_1.syncMyFonts)();
            if (this.__destroyed)
                return;
            this.setData({
                fonts: list.map((f) => ({ id: f.id, family: f.family, url: f.url, sizeText: fmtSize(f.size) })),
            });
        }
        catch (e) {
            wx.showToast({ title: (0, upload_1.errorText)(e), icon: 'none' });
        }
        finally {
            if (!this.__destroyed)
                this.setData({ loading: false });
        }
    },
    async onGoLogin() {
        try {
            await (0, auth_1.login)();
            if (this.__destroyed)
                return;
            this.setData({ loggedIn: true });
            void this.load();
        }
        catch (e) {
            wx.showToast({ title: (0, upload_1.errorText)(e), icon: 'none' });
        }
    },
    async onUpload() {
        if (!(0, prefs_1.isLoggedIn)()) {
            this.onGoLogin();
            return;
        }
        if (this.data.uploading)
            return;
        try {
            const path = await (0, upload_1.chooseFontFile)();
            this.setData({ uploading: true });
            wx.showLoading({ title: '上传中', mask: true });
            await (0, upload_1.uploadFont)(path);
            wx.hideLoading();
            wx.showToast({ title: '字体已上传', icon: 'success' });
            await this.load();
        }
        catch (e) {
            wx.hideLoading();
            wx.showToast({ title: (0, upload_1.errorText)(e), icon: 'none' });
        }
        finally {
            if (!this.__destroyed)
                this.setData({ uploading: false });
        }
    },
    onDelete(e) {
        const id = String(e.currentTarget.dataset.id || '');
        const family = String(e.currentTarget.dataset.family || '');
        if (!id)
            return;
        wx.showModal({
            title: '删除字体',
            content: `确定删除「${family}」？删除后将释放云空间。`,
            confirmColor: '#E5484D',
            success: (res) => {
                if (!res.confirm)
                    return;
                void (0, upload_1.removeFont)(id)
                    .then(() => {
                    wx.showToast({ title: '已删除', icon: 'none' });
                    return this.load();
                })
                    .catch((err) => wx.showToast({ title: (0, upload_1.errorText)(err), icon: 'none' }));
            },
        });
    },
    async onPreview(e) {
        const id = String(e.currentTarget.dataset.id || '');
        const family = String(e.currentTarget.dataset.family || '');
        const url = String(e.currentTarget.dataset.url || '');
        if (!family || !url)
            return;
        try {
            await (0, upload_1.loadFontFace)(family, url);
            if (this.__destroyed)
                return;
            this.setData({ previewFamily: family, previewingId: id });
        }
        catch (err) {
            wx.showToast({ title: (0, upload_1.errorText)(err), icon: 'none' });
        }
    },
    onSetReading(e) {
        const family = String(e.currentTarget.dataset.family || '');
        if (!family)
            return;
        (0, upload_1.rememberFont)(family);
        wx.showToast({ title: `已设为阅读字体：${family}`, icon: 'none' });
    },
});
