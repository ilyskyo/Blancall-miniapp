"use strict";
/**
 * 标签管理：标签 CRUD（名称/颜色/排序）+ 文章数展示
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const entities_1 = require("../../../../core/storage/entities");
const bus_1 = require("../../../../core/store/bus");
const indexLogic_1 = require("./indexLogic");
let offTheme = null;
/** 当前标签列表快照（排序/编辑时复用） */
let allTags = [];
Page({
    data: {
        themeStyle: '',
        rightText: '新建',
        tags: [],
        // 编辑浮层
        showEditor: false,
        editorTitle: '新建标签',
        editMode: 'create',
        editUuid: '',
        editName: '',
        editColor: 0,
        palette: (0, indexLogic_1.buildPaletteRows)(0),
    },
    onLoad() {
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        this.reload();
    },
    onShow() {
        this.reload();
    },
    onUnload() {
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    /** 从存储重建列表（含每标签文章数） */
    reload() {
        allTags = entities_1.tagStore.list().sort((a, b) => a.order - b.order);
        const seen = new Map();
        for (const link of entities_1.tagLinkStore.list()) {
            let set = seen.get(link.tagUuid);
            if (!set) {
                set = new Set();
                seen.set(link.tagUuid, set);
            }
            set.add(link.articleUuid);
        }
        const counts = new Map();
        seen.forEach((set, tagUuid) => counts.set(tagUuid, set.size));
        this.setData({ tags: (0, indexLogic_1.buildTagRows)(allTags, counts) });
    },
    // ============================== 编辑浮层 ==============================
    onNew() {
        this.setData({
            showEditor: true,
            editorTitle: '新建标签',
            editMode: 'create',
            editUuid: '',
            editName: '',
            editColor: 0,
            palette: (0, indexLogic_1.buildPaletteRows)(0),
        });
    },
    onEdit(e) {
        const uuid = String(e.currentTarget.dataset.uuid);
        const tag = allTags.find((t) => t.uuid === uuid);
        if (!tag)
            return;
        this.setData({
            showEditor: true,
            editorTitle: '编辑标签',
            editMode: 'edit',
            editUuid: uuid,
            editName: tag.name,
            editColor: tag.color,
            palette: (0, indexLogic_1.buildPaletteRows)(tag.color),
        });
    },
    onNameInput(e) {
        this.setData({ editName: e.detail.value });
    },
    onPickColor(e) {
        const color = Number(e.currentTarget.dataset.index);
        this.setData({ editColor: color, palette: (0, indexLogic_1.buildPaletteRows)(color) });
    },
    onCancelEdit() {
        this.setData({ showEditor: false });
    },
    onConfirmEdit() {
        const name = (this.data.editName || '').trim();
        if (!name) {
            wx.showToast({ title: '请输入标签名称', icon: 'none' });
            return;
        }
        const { editMode, editUuid, editColor } = this.data;
        try {
            if (editMode === 'create') {
                (0, entities_1.createTag)(name, editColor);
                this.finishMutation('已新建');
            }
            else {
                const tag = allTags.find((t) => t.uuid === editUuid);
                if (tag)
                    entities_1.tagStore.upsert({ ...tag, name, color: editColor, updatedAt: Date.now() });
                this.finishMutation('已保存');
            }
        }
        catch (err) {
            wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' });
        }
    },
    finishMutation(tip) {
        this.setData({ showEditor: false, editMode: 'create', editUuid: '', editName: '' });
        (0, bus_1.emit)(bus_1.EVT.tagsChanged);
        this.reload();
        wx.showToast({ title: tip, icon: 'none' });
    },
    // ============================== 排序 / 删除 ==============================
    onMove(e) {
        const uuid = String(e.currentTarget.dataset.uuid);
        const dir = Number(e.currentTarget.dataset.dir);
        const index = allTags.findIndex((t) => t.uuid === uuid);
        const next = (0, indexLogic_1.moveInList)(allTags, index, dir);
        if (next === allTags)
            return;
        allTags = next;
        allTags.forEach((t, i) => {
            if (t.order !== i)
                entities_1.tagStore.upsert({ ...t, order: i, updatedAt: Date.now() });
        });
        (0, bus_1.emit)(bus_1.EVT.tagsChanged);
        this.reload();
    },
    onDelete(e) {
        const uuid = String(e.currentTarget.dataset.uuid);
        const tag = allTags.find((t) => t.uuid === uuid);
        if (!tag)
            return;
        wx.showModal({
            title: '删除标签',
            content: `确定删除「${tag.name}」？已关联的文章不会被删除，仅解除标签关联。`,
            confirmText: '删除',
            confirmColor: '#E5484D',
            success: (res) => {
                if (!res.confirm)
                    return;
                try {
                    (0, entities_1.deleteTag)(uuid);
                    (0, bus_1.emit)(bus_1.EVT.tagsChanged);
                    this.reload();
                    wx.showToast({ title: '已删除', icon: 'none' });
                }
                catch (err) {
                    wx.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' });
                }
            },
        });
    },
});
