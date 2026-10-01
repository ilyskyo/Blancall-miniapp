/**
 * 标签管理：标签 CRUD（名称/颜色/排序）+ 文章数展示
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { TagEntity, createTag, deleteTag, tagLinkStore, tagStore } from '../../../../core/storage/entities';
import { EVT, emit } from '../../../../core/store/bus';
import { buildPaletteRows, buildTagRows, moveInList, TagRow } from './indexLogic';

let offTheme: (() => void) | null = null;
/** 当前标签列表快照（排序/编辑时复用） */
let allTags: TagEntity[] = [];

Page({
  data: {
    themeStyle: '',
    rightText: '新建',
    tags: [] as TagRow[],
    // 编辑浮层
    showEditor: false,
    editorTitle: '新建标签',
    editMode: 'create' as 'create' | 'edit',
    editUuid: '',
    editName: '',
    editColor: 0,
    palette: buildPaletteRows(0),
  },

  onLoad() {
    this.setData({ themeStyle: themeStyle() });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
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
    allTags = tagStore.list().sort((a, b) => a.order - b.order);
    const seen = new Map<string, Set<string>>();
    for (const link of tagLinkStore.list()) {
      let set = seen.get(link.tagUuid);
      if (!set) {
        set = new Set<string>();
        seen.set(link.tagUuid, set);
      }
      set.add(link.articleUuid);
    }
    const counts = new Map<string, number>();
    seen.forEach((set, tagUuid) => counts.set(tagUuid, set.size));
    this.setData({ tags: buildTagRows(allTags, counts) });
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
      palette: buildPaletteRows(0),
    });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const tag = allTags.find((t) => t.uuid === uuid);
    if (!tag) return;
    this.setData({
      showEditor: true,
      editorTitle: '编辑标签',
      editMode: 'edit',
      editUuid: uuid,
      editName: tag.name,
      editColor: tag.color,
      palette: buildPaletteRows(tag.color),
    });
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ editName: e.detail.value });
  },

  onPickColor(e: WechatMiniprogram.TouchEvent) {
    const color = Number(e.currentTarget.dataset.index);
    this.setData({ editColor: color, palette: buildPaletteRows(color) });
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
        createTag(name, editColor);
        this.finishMutation('已新建');
      } else {
        const tag = allTags.find((t) => t.uuid === editUuid);
        if (tag) tagStore.upsert({ ...tag, name, color: editColor, updatedAt: Date.now() });
        this.finishMutation('已保存');
      }
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' });
    }
  },

  finishMutation(tip: string) {
    this.setData({ showEditor: false, editMode: 'create', editUuid: '', editName: '' });
    emit(EVT.tagsChanged);
    this.reload();
    wx.showToast({ title: tip, icon: 'none' });
  },

  // ============================== 排序 / 删除 ==============================

  onMove(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const dir = Number(e.currentTarget.dataset.dir);
    const index = allTags.findIndex((t) => t.uuid === uuid);
    const next = moveInList(allTags, index, dir);
    if (next === allTags) return;
    allTags = next;
    allTags.forEach((t, i) => {
      if (t.order !== i) tagStore.upsert({ ...t, order: i, updatedAt: Date.now() });
    });
    emit(EVT.tagsChanged);
    this.reload();
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const tag = allTags.find((t) => t.uuid === uuid);
    if (!tag) return;
    wx.showModal({
      title: '删除标签',
      content: `确定删除「${tag.name}」？已关联的文章不会被删除，仅解除标签关联。`,
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        try {
          deleteTag(uuid);
          emit(EVT.tagsChanged);
          this.reload();
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' });
        }
      },
    });
  },
});
