"use strict";
/**
 * 阅读模式页（参数 articleUuid）
 * 分节阅读 + 排版设置 + 背诵遮挡 + 断点与时长统计
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
const prefs_1 = require("../../core/storage/prefs");
const entities_1 = require("../../core/storage/entities");
const upload_1 = require("../../core/upload");
const date_1 = require("../../core/utils/date");
const indexLogic_1 = require("./indexLogic");
/** 主题订阅解绑 */
let offTheme = null;
/** 正文全文（不入 data，避免重复渲染） */
let articleContent = '';
/** 阅读区高度测量（滚动进度） */
let scrollInfo = { top: 0, contentH: 1, viewH: 1 };
/** 每 20s 落盘一次的累计秒 */
let pendingSeconds = 0;
/** 计时器与手势起点（页面单实例，用模块级变量承载） */
let tickTimer = null;
let hideTimer = null;
let startX = 0;
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        statusBarHeight: 20,
        articleUuid: '',
        title: '',
        notFound: false,
        sections: [],
        currentSection: null,
        sectionCount: 0,
        currentIndex: 0,
        pageMode: false,
        layoutMode: 0,
        layoutOptions: indexLogic_1.LAYOUT_OPTIONS,
        scrollIntoId: '',
        contentPadTop: 104,
        accentHex: '',
        indent: true,
        // 排版
        fontPx: 17,
        lineHeight: 2.0,
        fontWeight: 400,
        fontId: '0',
        fontOptions: indexLogic_1.FONT_PRESETS,
        fontCloud: [],
        fontWeights: indexLogic_1.FONT_WEIGHTS,
        contentStyle: '',
        readingBg: '',
        bgMode: 0,
        bgOptions: indexLogic_1.BG_OPTIONS,
        // 遮挡
        occlusionEnabled: false,
        occlusionMode: 'long',
        occlusionModes: indexLogic_1.OCCLUSION_MODES,
        occlusionColorIndex: 0,
        customAvailable: false,
        customConfigUuid: '',
        maskConfigNames: [],
        maskConfigIndex: -1,
        maskConfigText: '选择配置',
        // 控件
        controlsVisible: true,
        panelVisible: false,
        // 统计
        elapsed: 0,
        elapsedText: '0秒',
        progressPercent: 0,
        percentText: '0%',
        sectionText: '1 / 1',
        // 锁标
        lockFeature: 'occlusion',
    },
    onLoad(query) {
        this.__destroyed = false;
        const uuid = query.articleUuid || '';
        const sbh = (0, theme_1.statusBarHeight)();
        this.setData({ themeStyle: (0, theme_1.themeStyle)(), statusBarHeight: sbh, contentPadTop: sbh + 84, articleUuid: uuid, accentHex: (0, theme_1.currentTheme)().accent });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style, accentHex: (0, theme_1.currentTheme)().accent }));
        const article = uuid ? entities_1.articleStore.find(uuid) : undefined;
        if (!article) {
            this.setData({ notFound: true });
            wx.showToast({ title: '文章不存在或已删除', icon: 'none' });
            setTimeout(() => this.onBack(), 900);
            return;
        }
        articleContent = article.content;
        this.setData({ title: article.title });
        const p = (0, entities_1.getReaderPrefs)(uuid);
        const fontId = p.fontId || '0';
        this.setData({
            indent: (0, prefs_1.getSettings)().autoIndentEnabled,
            layoutMode: p.layoutMode,
            pageMode: p.layoutMode === 1,
            fontPx: p.fontPx,
            lineHeight: p.lineHeight,
            fontWeight: p.fontWeight,
            fontId,
            bgMode: p.bgMode,
            occlusionEnabled: p.occlusionEnabled,
            occlusionMode: p.occlusionMode || 'long',
            occlusionColorIndex: (0, indexLogic_1.clampColorIndex)(p.occlusionColor),
            customConfigUuid: p.occlusionCustomConfigUuid || '',
            customAvailable: true,
        });
        this.refreshMaskConfigs();
        this.applyTypography();
        this.rebuild();
        // 恢复断点
        const pos = (0, indexLogic_1.loadReadingPos)(uuid);
        const idx = Math.round(pos * Math.max(0, this.data.sectionCount - 1));
        this.goSection(idx, false);
        if (!this.data.pageMode && this.data.sectionCount > 0)
            this.setData({ scrollIntoId: `sec${idx}` });
        this.startTick();
        this.scheduleHide();
        void this.loadCloudFonts();
    },
    onReady() {
        setTimeout(() => this.measure(), 60);
    },
    onShow() {
        this.startTick();
    },
    onHide() {
        // 页面被覆盖（进子页/切后台）时必须停止计时：否则阅读时长会持续累加，污染学习时长统计
        this.stopTick();
        this.flush();
    },
    onUnload() {
        this.__destroyed = true;
        // 清理 3 秒自动隐藏控件的计时器，避免销毁后 setData
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        this.flush();
        this.stopTick();
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    // ---------- 加载与刷新 ----------
    async loadCloudFonts() {
        try {
            const fonts = await (0, upload_1.syncMyFonts)();
            if (this.__destroyed)
                return;
            const names = fonts.map((f) => f.family).filter(Boolean);
            this.setData({ fontCloud: names, fontOptions: [...indexLogic_1.FONT_PRESETS, ...names.map((n) => ({ id: n, name: n, family: `'${n}',serif` }))] });
            this.applyTypography();
        }
        catch {
            /* 未登录或加载失败：仅用预设 */
        }
    },
    /** 刷新遮罩配置列表（自定义遮挡用） */
    refreshMaskConfigs() {
        const list = (0, entities_1.maskConfigsOfArticle)(this.data.articleUuid);
        const names = list.map((c) => c.name);
        let index = list.findIndex((c) => c.uuid === this.data.customConfigUuid);
        if (index < 0 && list.length > 0)
            index = 0;
        this.setData({
            maskConfigNames: names,
            maskConfigIndex: index,
            maskConfigText: index >= 0 ? names[index] : '选择配置',
            customConfigUuid: index >= 0 ? list[index].uuid : '',
        });
    },
    /** 应用排版（内容样式 + 阅读背景） */
    applyTypography() {
        const family = (0, indexLogic_1.fontFamilyOf)(this.data.fontId, this.data.fontCloud);
        this.setData({
            contentStyle: (0, indexLogic_1.buildContentStyle)(this.data.fontPx, this.data.lineHeight, this.data.fontWeight, family),
            readingBg: (0, indexLogic_1.readingBackground)((0, prefs_1.getSettings)(), this.data.bgMode),
        });
    },
    /** 重建渲染节（含遮挡） */
    rebuild() {
        const customSpans = this.currentCustomSpans();
        const sections = (0, indexLogic_1.buildRenderSections)(articleContent, {
            enabled: this.data.occlusionEnabled,
            mode: this.data.occlusionMode,
            colorIndex: (0, indexLogic_1.clampColorIndex)(this.data.occlusionColorIndex),
            customSpans,
        });
        this.setData({ sections, sectionCount: sections.length });
        this.setData({ currentSection: sections[Math.min(this.data.currentIndex, sections.length - 1)] || null });
        this.updateProgress();
        setTimeout(() => this.measure(), 60);
    },
    currentCustomSpans() {
        if (!this.data.occlusionEnabled || this.data.occlusionMode !== 'custom')
            return null;
        const cfg = (0, entities_1.maskConfigsOfArticle)(this.data.articleUuid).find((c) => c.uuid === this.data.customConfigUuid);
        return cfg ? cfg.spans : null;
    },
    // ---------- 计时与进度 ----------
    startTick() {
        this.stopTick();
        tickTimer = setInterval(() => {
            const elapsed = this.data.elapsed + 1;
            pendingSeconds += 1;
            const patch = { elapsed, elapsedText: (0, date_1.formatDuration)(elapsed) };
            this.setData(patch);
            if (pendingSeconds >= 20) {
                (0, entities_1.addReadingSeconds)(pendingSeconds);
                pendingSeconds = 0;
            }
        }, 1000);
    },
    stopTick() {
        if (tickTimer) {
            clearInterval(tickTimer);
            tickTimer = null;
        }
    },
    /** 落盘未满 20s 的累计秒与断点 */
    flush() {
        if (pendingSeconds > 0) {
            (0, entities_1.addReadingSeconds)(pendingSeconds);
            pendingSeconds = 0;
        }
        (0, indexLogic_1.saveReadingPos)(this.data.articleUuid, this.data.progressPercent / 100);
    },
    measure() {
        wx.createSelectorQuery()
            .select('#readerContent')
            .boundingClientRect((rect) => {
            const r = rect;
            if (r && r.height)
                scrollInfo.contentH = r.height;
        })
            .select('.reader-scroll')
            .boundingClientRect((rect) => {
            const r = rect;
            if (r && r.height)
                scrollInfo.viewH = r.height;
        })
            .exec(() => this.updateProgress());
    },
    updateProgress() {
        if (this.__destroyed)
            return;
        let percent = 0;
        if (this.data.pageMode) {
            const n = Math.max(1, this.data.sectionCount - 1);
            percent = this.data.currentIndex / n;
        }
        else {
            const total = Math.max(1, scrollInfo.contentH - scrollInfo.viewH);
            percent = Math.min(1, Math.max(0, scrollInfo.top / total));
        }
        const pct = Math.min(100, Math.max(0, Math.round(percent * 100)));
        this.setData({
            progressPercent: pct,
            percentText: `${pct}%`,
            sectionText: `${this.data.sectionCount === 0 ? 0 : this.data.currentIndex + 1} / ${this.data.sectionCount}`,
        });
    },
    onScroll(e) {
        scrollInfo.top = e.detail.scrollTop;
        this.updateProgress();
    },
    // ---------- 交互 ----------
    onBack() {
        this.flush();
        const pages = getCurrentPages();
        if (pages.length > 1)
            wx.navigateBack({ delta: 1 });
        else
            wx.switchTab({ url: '/pages/home/index' });
    },
    /** 显示控件并重置自动隐藏计时 */
    showControls() {
        if (!this.data.controlsVisible)
            this.setData({ controlsVisible: true });
        this.scheduleHide();
    },
    scheduleHide() {
        if (hideTimer)
            clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (this.data.panelVisible)
                return;
            this.setData({ controlsVisible: false });
        }, 3000);
    },
    toggleControls() {
        if (this.data.panelVisible)
            return;
        const visible = !this.data.controlsVisible;
        this.setData({ controlsVisible: visible });
        if (visible)
            this.scheduleHide();
    },
    onOpenPanel() {
        this.setData({ panelVisible: true, controlsVisible: true });
        if (hideTimer)
            clearTimeout(hideTimer);
    },
    onClosePanel() {
        this.setData({ panelVisible: false });
        this.scheduleHide();
    },
    /** 点击正文片段：遮挡块揭示/遮回，普通片段切换控件 */
    onSegTap(e) {
        var _a;
        const ds = e.currentTarget.dataset;
        const si = Number(ds.si);
        const pi = Number(ds.pi);
        const gi = Number(ds.gi);
        const seg = this.data.sections[si] && this.data.sections[si].paras[pi] && this.data.sections[si].paras[pi].segs[gi];
        if (seg && seg.occluded) {
            this.setData({ [`sections[${si}].paras[${pi}].segs[${gi}].revealed`]: !seg.revealed });
            this.showControls();
            (_a = wx.vibrateShort) === null || _a === void 0 ? void 0 : _a.call(wx, { type: 'light' });
            return;
        }
        this.toggleControls();
    },
    onTouchStart(e) {
        if (e.touches && e.touches[0])
            startX = e.touches[0].clientX;
    },
    onTouchEnd(e) {
        if (!this.data.pageMode)
            return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t)
            return;
        const dx = t.clientX - startX;
        if (Math.abs(dx) < 50)
            return;
        this.goSection(this.data.currentIndex + (dx < 0 ? 1 : -1), true);
    },
    goSection(index, animate) {
        const n = this.data.sectionCount;
        const clamped = Math.max(0, Math.min(Math.max(0, n - 1), index));
        this.setData({
            currentIndex: clamped,
            currentSection: this.data.sections[clamped] || null,
            scrollIntoId: animate && !this.data.pageMode ? `sec${clamped}` : this.data.scrollIntoId,
        });
        this.updateProgress();
        if (animate)
            this.savePosSoon();
    },
    savePosSoon() {
        (0, indexLogic_1.saveReadingPos)(this.data.articleUuid, this.data.progressPercent / 100);
    },
    // ---------- 排版设置 ----------
    onSelectLayout(e) {
        const value = Number(e.currentTarget.dataset.value) || 0;
        this.setData({ layoutMode: value, pageMode: value === 1, currentIndex: 0 });
        this.persist({ layoutMode: value });
        this.updateProgress();
        setTimeout(() => this.measure(), 60);
    },
    onFontSizeChanging(e) {
        this.setData({ fontPx: e.detail.value });
        this.applyTypography();
    },
    onFontSizeChange(e) {
        this.persist({ fontPx: e.detail.value });
    },
    onLineHeightChanging(e) {
        const lineHeight = Math.round(e.detail.value * 10) / 10;
        this.setData({ lineHeight });
        this.applyTypography();
    },
    onLineHeightChange(e) {
        this.persist({ lineHeight: Math.round(e.detail.value * 10) / 10 });
    },
    onSelectBg(e) {
        const value = Number(e.currentTarget.dataset.value) || 0;
        this.setData({ bgMode: value });
        this.applyTypography();
        this.persist({ bgMode: value });
    },
    onSelectFont(e) {
        const fontId = String(e.currentTarget.dataset.id) || '0';
        this.setData({ fontId });
        this.applyTypography();
        this.persist({ fontId });
    },
    onSelectWeight(e) {
        const value = Number(e.currentTarget.dataset.value) || 400;
        this.setData({ fontWeight: value });
        this.applyTypography();
        this.persist({ fontWeight: value });
    },
    /** 写阅读偏好（按文章独立 + 同步全局默认） */
    persist(patch) {
        try {
            (0, entities_1.saveReaderPrefs)(this.data.articleUuid, patch);
            (0, prefs_1.updateSettings)(patch);
        }
        catch {
            /* 忽略 */
        }
    },
    // ---------- 背诵遮挡 ----------
    onToggleOcclusion() {
        const next = !this.data.occlusionEnabled;
        this.setData({ occlusionEnabled: next });
        this.persist({ occlusionEnabled: next });
        this.rebuild();
    },
    onSelectOcclusionMode(e) {
        const value = String(e.currentTarget.dataset.value);
        if (value === 'custom') {
            if (this.data.maskConfigNames.length === 0) {
                wx.showModal({
                    title: '暂无自定义遮挡配置',
                    content: '需要先在该文章中创建遮挡配置，是否前往创建？',
                    confirmText: '去创建',
                    success: (res) => {
                        if (res.confirm)
                            wx.navigateTo({ url: `/packages/tools/pages/mask-config/index?articleUuid=${this.data.articleUuid}` });
                    },
                });
                return;
            }
        }
        this.setData({ occlusionMode: value });
        this.persist({ occlusionMode: value });
        this.rebuild();
    },
    onPickMaskConfig(e) {
        const idx = Number(e.detail.value) || 0;
        const list = (0, entities_1.maskConfigsOfArticle)(this.data.articleUuid);
        const cfg = list[idx];
        if (!cfg)
            return;
        this.setData({
            maskConfigIndex: idx,
            maskConfigText: cfg.name,
            customConfigUuid: cfg.uuid,
            occlusionMode: 'custom',
            occlusionEnabled: true,
        });
        this.persist({ occlusionCustomConfigUuid: cfg.uuid, occlusionMode: 'custom', occlusionEnabled: true });
        this.rebuild();
    },
    onGoMaskConfig() {
        wx.navigateTo({ url: `/packages/tools/pages/mask-config/index?articleUuid=${this.data.articleUuid}` });
    },
});
