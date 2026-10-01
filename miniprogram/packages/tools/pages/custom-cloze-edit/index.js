"use strict";
/**
 * 自定义挖空编辑：点击字符区间挖空、长按 句→词→字 循环拆解、撤销/重做（20）、按句全选、保存
 * 坐标口径与练习引擎一致（SentenceSplitter.split 的句索引 + 句内半开区间）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const sentence_1 = require("../../../../core/algorithms/sentence");
const entities_1 = require("../../../../core/storage/entities");
const digest_1 = require("../../../../core/utils/digest");
const uuid_1 = require("../../../../core/utils/uuid");
const draft_1 = require("../../../../core/editor/draft");
const indexLogic_1 = require("./indexLogic");
let offTheme = null;
/** 草稿键：按文章隔离（iOS 未保存离开的兜底存储） */
function draftKey() {
    return `custom_cloze:${articleUuid}`;
}
// ---------- 页面级可变状态（不触发渲染的数据放模块级，减少 setData） ----------
let content = '';
let sentences = [];
let blanks = [];
let undoStack = [];
let redoStack = [];
let pending = null;
let dirty = false;
let articleUuid = '';
let configUuid = '';
let configMode = 'SENTENCE';
let configLevels = [];
let configCreatedAt = 0;
/** 返回拦截（基础库差异，安全调用） */
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
Page({
    data: {
        themeStyle: '',
        articleTitle: '',
        name: '',
        /** 限时免费活动：展示灰色小按键 */
        sentences: [],
        blankCount: 0,
        canUndo: false,
        canRedo: false,
        dirtyText: '已保存',
    },
    onLoad(query) {
        articleUuid = query.articleUuid || '';
        const article = entities_1.articleStore.find(articleUuid);
        if (!article) {
            wx.showToast({ title: '文章不存在', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 800);
            return;
        }
        content = article.content;
        sentences = sentence_1.SentenceSplitter.split(content);
        blanks = [];
        undoStack = [];
        redoStack = [];
        pending = null;
        dirty = false;
        const configId = query.configId || '';
        const existing = configId ? (0, entities_1.customClozeOfArticle)(articleUuid).find((c) => c.uuid === configId) || null : null;
        if (existing) {
            configUuid = existing.uuid;
            configMode = existing.mode;
            configLevels = existing.levels || [];
            configCreatedAt = existing.createdAt;
            blanks = (0, indexLogic_1.snapshot)(existing.blanks || []);
            if (existing.contentHash && existing.contentHash !== (0, digest_1.md5Hex)(content)) {
                setTimeout(() => wx.showToast({ title: '文章已修改，配置位置可能失准', icon: 'none', duration: 2600 }), 350);
            }
        }
        else {
            configUuid = '';
            configMode = 'SENTENCE';
            configLevels = [];
            configCreatedAt = 0;
        }
        const name = existing ? existing.name : `配置 ${(0, entities_1.customClozeOfArticle)(articleUuid).length + 1}`;
        this.setData({ themeStyle: (0, theme_1.themeStyle)(), articleTitle: article.title, name });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        this.refresh();
        // iOS 兜底：wx.enableAlertBeforeUnload 仅 Android 生效，iOS 用草稿暂存避免编辑丢失
        (0, draft_1.promptRestoreDraft)(draftKey(), '自定义挖空编辑', (data) => {
            blanks = (0, indexLogic_1.snapshot)(data.blanks || []);
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
        this.setData({
            sentences: (0, indexLogic_1.buildSentenceViews)(sentences, blanks, pending),
            blankCount: blanks.length,
            canUndo: undoStack.length > 0,
            canRedo: redoStack.length > 0,
            dirtyText: dirty ? '未保存' : '已保存',
        });
        setUnloadGuard(dirty ? '有未保存的修改，确定离开？' : null);
        // iOS 兜底：变更即防抖写草稿（Android 走系统拦截，helper 内部会跳过）
        if (dirty) {
            (0, draft_1.scheduleDraft)(draftKey(), () => ({ blanks: (0, indexLogic_1.snapshot)(blanks), name: this.data.name }));
        }
    },
    pushUndo() {
        (0, indexLogic_1.pushBounded)(undoStack, (0, indexLogic_1.snapshot)(blanks));
        redoStack = [];
        dirty = true;
    },
    // ============================== 交互 ==============================
    onNameInput(e) {
        dirty = true;
        this.setData({ name: e.detail.value, dirtyText: '未保存' });
    },
    onTapChar(e) {
        const si = Number(e.currentTarget.dataset.si);
        const ci = Number(e.currentTarget.dataset.ci);
        const hit = (0, indexLogic_1.blankAt)(blanks, si, ci);
        if (!pending) {
            if (hit) {
                this.pushUndo();
                blanks = blanks.filter((x) => x !== hit);
                this.refresh();
                return;
            }
            pending = { s: si, a: ci };
            this.refresh();
            return;
        }
        if (pending.s !== si) {
            pending = { s: si, a: ci };
            this.refresh();
            return;
        }
        const start = Math.min(pending.a, ci);
        const end = Math.max(pending.a, ci) + 1;
        this.pushUndo();
        blanks = blanks.filter((x) => !(x.s === si && x.a < end && start < x.b));
        blanks = blanks.concat([{ s: si, a: start, b: end }]);
        pending = null;
        this.refresh();
    },
    onLongPress(e) {
        const si = Number(e.currentTarget.dataset.si);
        const ci = Number(e.currentTarget.dataset.ci);
        const sentence = sentences[si] || '';
        if (!sentence)
            return;
        const clause = (0, indexLogic_1.clauseOf)(sentence, ci);
        const level = (0, indexLogic_1.nextGranularity)(blanks, si, sentence, clause);
        this.pushUndo();
        blanks = blanks.filter((b) => !(b.s === si && b.a >= clause.start && b.b <= clause.end));
        const units = (0, indexLogic_1.unitsForClause)(sentence, clause, level);
        blanks = blanks.concat(units.map((u) => ({ s: si, a: u.start, b: u.end })));
        pending = null;
        this.refresh();
        wx.showToast({ title: `已按${indexLogic_1.GRANULARITY_LABEL[level]}拆解`, icon: 'none' });
    },
    onUndo() {
        if (undoStack.length === 0)
            return;
        redoStack.push((0, indexLogic_1.snapshot)(blanks));
        blanks = undoStack.pop();
        pending = null;
        this.refresh();
    },
    onRedo() {
        if (redoStack.length === 0)
            return;
        undoStack.push((0, indexLogic_1.snapshot)(blanks));
        blanks = redoStack.pop();
        pending = null;
        this.refresh();
    },
    onClear() {
        if (blanks.length === 0)
            return;
        this.pushUndo();
        blanks = [];
        pending = null;
        this.refresh();
    },
    onSelectAll() {
        this.pushUndo();
        blanks = (0, indexLogic_1.toggleAllSentences)(sentences, blanks);
        pending = null;
        this.refresh();
    },
    // ============================== 保存 ==============================
    onSave() {
        const name = (this.data.name || '').trim() || '未命名配置';
        try {
            const entity = {
                uuid: configUuid || (0, uuid_1.uuidv7)(),
                articleUuid,
                name,
                createdAt: configCreatedAt || Date.now(),
                mode: configMode,
                levels: configLevels,
                contentHash: (0, digest_1.md5Hex)(content),
                blanks: (0, indexLogic_1.snapshot)(blanks),
                updatedAt: Date.now(),
            };
            entities_1.customClozeStore.upsert(entity);
            configUuid = entity.uuid;
            configCreatedAt = entity.createdAt;
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
