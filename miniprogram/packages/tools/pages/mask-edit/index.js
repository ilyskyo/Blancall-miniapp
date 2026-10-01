"use strict";
/**
 * 遮罩编辑：段落内选区间 + 颜色 0–5 + 长按 句→词→字 拆解 + 撤销/重做（20）+ 预览（揭示/遮回）
 * spans 通过 MaskSpanOps.toggle/merge 维护，保存时写入 maskConfigStore（含 contentHash）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const maskSpan_1 = require("../../../../core/algorithms/maskSpan");
const occlusion_1 = require("../../../../core/algorithms/occlusion");
const entities_1 = require("../../../../core/storage/entities");
const digest_1 = require("../../../../core/utils/digest");
const draft_1 = require("../../../../core/editor/draft");
const indexLogic_1 = require("./indexLogic");
let offTheme = null;
// ---------- 模块级可变状态 ----------
let content = '';
let paras = [];
let spans = [];
let undoStack = [];
let redoStack = [];
let pending = null;
let revealed = new Set();
let dirty = false;
let articleUuid = '';
/** 草稿键：按文章+配置隔离（iOS 未保存离开的兜底存储） */
function draftKey() {
    return `mask:${articleUuid}:${configUuid}`;
}
let configUuid = '';
let configCreatedAt = 0;
let configSelected = false;
function setUnloadGuard(message) {
    const w = wx;
    try {
        if (message && w.enableAlertBeforeUnload)
            w.enableAlertBeforeUnload({ message });
        else if (w.disableAlertBeforeUnload)
            w.disableAlertBeforeUnload();
    }
    catch {
        /* 忽略 */
    }
}
function paletteRows(selected) {
    return indexLogic_1.MASK_COLORS.map((color, index) => ({
        color,
        index,
        cls: index === selected ? 'palette__item--on' : '',
    }));
}
Page({
    data: {
        themeStyle: '',
        articleTitle: '',
        name: '',
        /** 限时免费活动：展示灰色小按键 */
        selectedP: 0,
        colorIndex: 0,
        paragraphs: [],
        chars: [],
        preview: [],
        palette: paletteRows(0),
        spanCount: 0,
        canUndo: false,
        canRedo: false,
        dirtyText: '已保存',
    },
    onLoad(query) {
        articleUuid = query.articleUuid || '';
        configUuid = query.configId || '';
        const article = entities_1.articleStore.find(articleUuid);
        if (!article) {
            wx.showToast({ title: '文章不存在', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 800);
            return;
        }
        const config = entities_1.maskConfigStore.find(configUuid);
        if (!config || config.articleUuid !== articleUuid) {
            wx.showToast({ title: '配置不存在', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 800);
            return;
        }
        content = article.content;
        paras = occlusion_1.ReaderOcclusion.splitParagraphs(content);
        spans = (0, indexLogic_1.snapshotSpans)(config.spans || []);
        undoStack = [];
        redoStack = [];
        pending = null;
        revealed = new Set();
        dirty = false;
        configCreatedAt = config.createdAt;
        configSelected = !!config.selected;
        if (config.contentHash && config.contentHash !== (0, digest_1.md5Hex)(content)) {
            setTimeout(() => wx.showToast({ title: '文章已修改，配置位置可能失准', icon: 'none', duration: 2600 }), 350);
        }
        this.setData({ themeStyle: (0, theme_1.themeStyle)(), articleTitle: article.title, name: config.name });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        this.refresh();
        // iOS 兜底：wx.enableAlertBeforeUnload 仅 Android 生效，iOS 用草稿暂存避免编辑丢失
        (0, draft_1.promptRestoreDraft)(draftKey(), '遮罩编辑', (data) => {
            spans = (0, indexLogic_1.snapshotSpans)(data.spans || []);
            undoStack = [];
            redoStack = [];
            dirty = true;
            if (data.name)
                this.setData({ name: data.name });
            this.refresh();
            wx.showToast({ title: '已恢复未保存的编辑', icon: 'success' });
        });
    },
    onUnload() {
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
        setUnloadGuard(null);
    },
    // ============================== 渲染同步 ==============================
    refresh() {
        const p = this.data.selectedP;
        const text = paras[p] ? paras[p].text : '';
        const ranges = (0, indexLogic_1.rangesOfParagraph)(spans, p);
        this.setData({
            paragraphs: (0, indexLogic_1.buildParaRows)(paras, spans, p),
            chars: (0, indexLogic_1.buildCharViews)(text, ranges, pending),
            preview: (0, indexLogic_1.buildPreview)(text, ranges, revealed),
            spanCount: spans.length,
            canUndo: undoStack.length > 0,
            canRedo: redoStack.length > 0,
            dirtyText: dirty ? '未保存' : '已保存',
        });
        setUnloadGuard(dirty ? '有未保存的修改，确定离开？' : null);
        // iOS 兜底：变更即防抖写草稿（Android 走系统拦截，helper 内部会跳过）
        if (dirty) {
            (0, draft_1.scheduleDraft)(draftKey(), () => ({ spans: (0, indexLogic_1.snapshotSpans)(spans), name: this.data.name }));
        }
    },
    pushUndo() {
        (0, indexLogic_1.pushBounded)(undoStack, (0, indexLogic_1.snapshotSpans)(spans));
        redoStack = [];
        dirty = true;
    },
    // ============================== 交互 ==============================
    onPickPara(e) {
        const index = Number(e.currentTarget.dataset.index);
        pending = null;
        revealed = new Set();
        this.setData({ selectedP: index });
        this.refresh();
    },
    onPickColor(e) {
        const index = Number(e.currentTarget.dataset.index);
        this.setData({ colorIndex: index, palette: paletteRows(index) });
    },
    onNameInput(e) {
        dirty = true;
        this.setData({ name: e.detail.value, dirtyText: '未保存' });
    },
    onTapChar(e) {
        const p = this.data.selectedP;
        const ci = Number(e.currentTarget.dataset.ci);
        if (pending === null) {
            pending = ci;
            this.refresh();
            return;
        }
        const a = Math.min(pending, ci);
        const end = Math.max(pending, ci) + 1;
        this.pushUndo();
        spans = maskSpan_1.MaskSpanOps.toggle(spans, p, a, end, this.data.colorIndex);
        pending = null;
        this.refresh();
    },
    onLongPress(e) {
        const p = this.data.selectedP;
        const ci = Number(e.currentTarget.dataset.ci);
        const text = paras[p] ? paras[p].text : '';
        if (!text)
            return;
        const clause = (0, indexLogic_1.clauseOf)(text, ci);
        const level = (0, indexLogic_1.nextLevel)(spans, p, text, clause);
        this.pushUndo();
        spans = spans.filter((s) => !(s.p === p && s.a >= clause.start && s.e <= clause.end));
        const units = (0, indexLogic_1.unitsForClause)(text, clause, level);
        spans = spans.concat(units.map((u) => ({ p, a: u.start, e: u.end, c: this.data.colorIndex })));
        pending = null;
        this.refresh();
        wx.showToast({ title: `已按${indexLogic_1.GRANULARITY_LABEL[level]}拆解`, icon: 'none' });
    },
    onToggleReveal(e) {
        const key = Number(e.currentTarget.dataset.key);
        if (revealed.has(key))
            revealed.delete(key);
        else
            revealed.add(key);
        this.refresh();
    },
    onUndo() {
        if (undoStack.length === 0)
            return;
        redoStack.push((0, indexLogic_1.snapshotSpans)(spans));
        spans = undoStack.pop();
        pending = null;
        this.refresh();
    },
    onRedo() {
        if (redoStack.length === 0)
            return;
        undoStack.push((0, indexLogic_1.snapshotSpans)(spans));
        spans = redoStack.pop();
        pending = null;
        this.refresh();
    },
    onClearPara() {
        const p = this.data.selectedP;
        if (!spans.some((s) => s.p === p))
            return;
        this.pushUndo();
        spans = spans.filter((s) => s.p !== p);
        pending = null;
        this.refresh();
    },
    // ============================== 保存 ==============================
    onSave() {
        const name = (this.data.name || '').trim() || '未命名配置';
        try {
            const entity = {
                uuid: configUuid,
                articleUuid,
                name,
                createdAt: configCreatedAt || Date.now(),
                contentHash: (0, digest_1.md5Hex)(content),
                spans: maskSpan_1.MaskSpanOps.merge(spans),
                selected: configSelected,
                updatedAt: Date.now(),
            };
            entities_1.maskConfigStore.upsert(entity);
            dirty = false;
            (0, draft_1.clearDraft)(draftKey());
            setUnloadGuard(null);
            wx.showToast({ title: '已保存', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 500);
        }
        catch (err) {
            wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' });
        }
    },
    onShowLock() {
        this.setData({ lockVisible: true });
    },
    onLockClose() {
        this.setData({ lockVisible: false });
    },
});
