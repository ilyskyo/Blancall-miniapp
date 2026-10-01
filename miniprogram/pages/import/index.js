"use strict";
/**
 * 导入：粘贴文本 / 从聊天记录选择文件（txt·md 本地解析、其余走云端）/ 素材库示例
 * 云端解析需登录；PDF 另需 pdf_import 权益（缺权益弹 lock-mask）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
const entities_1 = require("../../core/storage/entities");
const prefs_1 = require("../../core/storage/prefs");
const auth_1 = require("../../core/net/auth");
const upload_1 = require("../../core/upload");
const gaokao_1 = require("../../core/library/gaokao");
const sync_1 = require("../../core/net/sync");
const bus_1 = require("../../core/store/bus");
const importLogic_1 = require("./importLogic");
let offTheme = null;
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        source: 'paste',
        tabs: [
            { value: 'paste', label: '粘贴文本' },
            { value: 'file', label: '聊天文件' },
        ],
        sampleAvailable: false,
        text: '',
        title: '',
        author: '',
        autoIndent: true,
        sourceName: '',
        sampleNo: 0,
        sampleTitle: '',
        wordCount: 0,
        preview: '',
        cloudBusy: false,
        lockVisible: false,
        lockFeature: '',
    },
    onLoad(query) {
        this.__destroyed = false;
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        const library = query.library || '';
        const no = Number(query.no || '0');
        const presetText = query.text || '';
        const presetTitle = query.title || '';
        if (presetText) {
            this.applyText(presetText, 'sample');
            this.setData({ sampleAvailable: true, sampleTitle: presetTitle || '示例文章' });
            if (presetTitle)
                this.setData({ title: presetTitle });
            return;
        }
        if (library && no > 0) {
            this.setData({
                sampleAvailable: true,
                source: 'sample',
                tabs: [
                    { value: 'paste', label: '粘贴文本' },
                    { value: 'file', label: '聊天文件' },
                    { value: 'sample', label: '示例导入' },
                ],
            });
            void this.loadSample(no);
            return;
        }
        this.refreshDerived();
    },
    onUnload() {
        this.__destroyed = true;
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    // ---------------- 来源切换 ----------------
    onTab(e) {
        const value = String(e.currentTarget.dataset.value || 'paste');
        this.setData({ source: value });
    },
    /** 载入素材库示例正文 */
    async loadSample(no) {
        wx.showLoading({ title: '加载示例…' });
        try {
            const item = await (0, gaokao_1.loadText)(no);
            if (this.__destroyed)
                return;
            const text = item.text || '';
            this.setData({ text, sampleNo: no, sampleTitle: item.title, title: this.data.title || item.title });
            this.applyText(text, 'sample');
        }
        catch (e) {
            wx.showToast({ title: (0, upload_1.errorText)(e), icon: 'none' });
        }
        finally {
            wx.hideLoading();
        }
    },
    /** 写入文本并刷新派生数据 */
    applyText(text, source) {
        const autoIndent = (0, prefs_1.getSettings)().autoIndentEnabled !== false;
        this.setData({
            text,
            source,
            autoIndent,
            title: this.data.title || (0, importLogic_1.titleFromText)(text, ''),
        });
        this.refreshDerived();
    },
    refreshDerived() {
        const text = this.data.text;
        this.setData({
            wordCount: (0, importLogic_1.wordCountOf)(text),
            preview: (0, importLogic_1.previewOf)(text, this.data.autoIndent),
        });
    },
    // ---------------- 表单 ----------------
    onTextInput(e) {
        const text = e.detail.value;
        this.setData({ text });
        if (!this.data.title.trim()) {
            const guess = (0, importLogic_1.titleFromText)(text, '');
            if (guess)
                this.setData({ title: guess });
        }
        this.refreshDerived();
    },
    onTitleInput(e) {
        this.setData({ title: e.detail.value });
    },
    onAuthorInput(e) {
        this.setData({ author: e.detail.value });
    },
    onToggleIndent(e) {
        this.setData({ autoIndent: e.detail.checked });
        this.refreshDerived();
    },
    // ---------------- 文件导入 ----------------
    async onPickFile() {
        let path = '';
        try {
            path = await (0, upload_1.chooseFile)(importLogic_1.ALL_EXTS);
        }
        catch (e) {
            const msg = (0, upload_1.errorText)(e);
            if (msg.indexOf('取消') < 0)
                wx.showToast({ title: msg, icon: 'none' });
            return;
        }
        if (this.__destroyed)
            return;
        const ext = (0, importLogic_1.extOf)(path);
        const name = (0, importLogic_1.fileNameOf)(path);
        if ((0, importLogic_1.isLocalText)(ext)) {
            const res = (0, importLogic_1.readLocalText)(path);
            if (res.encodingError) {
                // 与 Android 端一致：GB18030/GBK/Big5 应能直接导入。
                // 小程序端无法本地解码这些编码，改为提供"上传到云端转码导入"（服务端已内置编码探测）。
                wx.showModal({
                    title: '文件不是 UTF-8 编码',
                    content: '检测到可能是 GB18030/GBK/Big5 编码。可上传到云端自动转码后导入（需登录），或先用记事本另存为 UTF-8。',
                    confirmText: '云端转码导入',
                    cancelText: '稍后手动转换',
                    success: (r) => {
                        if (r.confirm)
                            void this.importFromCloud(path, ext, name, { skipExtCheck: true });
                    },
                });
                return;
            }
            if (!res.ok || !res.text.trim()) {
                wx.showToast({ title: '文件内容为空或读取失败', icon: 'none' });
                return;
            }
            this.setData({ sourceName: name, title: this.data.title || (0, importLogic_1.fileNameOf)(path).replace(/\.[^.]+$/, '') });
            this.applyText(res.text, 'file');
            wx.showToast({ title: `已读取 ${name}`, icon: 'success' });
            return;
        }
        // 其余格式（pdf/doc/docx/epub/rtf/html）走云端解析
        await this.importFromCloud(path, ext, name);
    },
    /**
     * 云端解析导入
     * @param opts.skipExtCheck 为 true 时用于「非 UTF-8 文本转码导入」：跳过 PDF 权益校验
     *   （txt/md 属免费能力，服务端会按编码自动探测后返回 UTF-8 文本）
     */
    async importFromCloud(path, ext, name, opts = {}) {
        if (!(0, auth_1.requireLogin)())
            return;
        // 解析服务未上线：仅 TXT/MD 可云端导入，其余格式提前拦截（避免无效上传）
        if (!opts.skipExtCheck && !['txt', 'md'].includes(ext)) {
            wx.showModal({
                title: '即将上线',
                content: 'PDF / DOCX 解析即将上线，请先上传 TXT / MD 文本',
                showCancel: false,
                confirmText: '我知道了',
            });
            return;
        }
        this.setData({ cloudBusy: true });
        wx.showLoading({ title: '上传解析中…' });
        try {
            const doc = await (0, upload_1.uploadDocument)(path, name);
            await (0, upload_1.importDocumentAsArticle)(doc.id, name.replace(/\.[^.]+$/, ''));
            (0, bus_1.emit)(bus_1.EVT.articlesChanged);
            wx.hideLoading();
            wx.showToast({ title: '已导入', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 700);
        }
        catch (e) {
            wx.hideLoading();
            wx.showToast({ title: (0, upload_1.errorText)(e), icon: 'none' });
        }
        finally {
            if (!this.__destroyed)
                this.setData({ cloudBusy: false });
        }
    },
    // ---------------- 保存 ----------------
    save() {
        const text = this.data.text;
        if (!text.trim()) {
            wx.showToast({ title: '请先输入或选择内容', icon: 'none' });
            return;
        }
        try {
            if (this.data.source === 'sample' && this.data.sampleNo > 0) {
                // 素材库导入：同标题同正文自动复用，避免重复
                const res = (0, gaokao_1.importToArticle)({ no: this.data.sampleNo, title: this.data.sampleTitle || (0, importLogic_1.titleFromText)(text), text });
                (0, bus_1.emit)(bus_1.EVT.articlesChanged);
                wx.showToast({ title: res.created ? '已导入' : '已存在，直接打开', icon: 'success' });
            }
            else {
                const title = this.data.title.trim() || (0, importLogic_1.titleFromText)(text);
                // 与 Android 端一致：纯文本记 autoIndent，PDF/DOCX 等保持原文
                (0, entities_1.createArticle)({
                    title,
                    content: text,
                    author: this.data.author.trim(),
                    autoIndent: this.data.autoIndent,
                });
                (0, bus_1.emit)(bus_1.EVT.articlesChanged);
                (0, sync_1.scheduleSync)();
                wx.showToast({ title: '已导入', icon: 'success' });
            }
            setTimeout(() => wx.navigateBack(), 700);
        }
        catch (e) {
            wx.showToast({ title: (0, upload_1.errorText)(e), icon: 'none' });
        }
    },
    // ---------------- 付费锁定 ----------------
    onCloseLock() {
        this.setData({ lockVisible: false });
    },
    onUnlockLock() {
        this.setData({ lockVisible: false });
    },
});
