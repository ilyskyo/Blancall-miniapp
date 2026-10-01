/**
 * 「我的文章」：列表 / 标签筛选 / 隐藏 / 排序 / 编辑标题作者 / 批量删除
 * 列表数据在 onShow 与每次筛选变化时重建。
 */

import { onThemeChange, themeStyle } from '../../core/theme/theme';
import { getSettings, updateSettings } from '../../core/storage/prefs';
import {
  articleStore,
  deleteArticleCascade,
  statsByArticle,
  tagsByArticle,
  tagStore,
  updateArticle,
} from '../../core/storage/entities';
import { EVT, PageLike, bindPageEvents, emit, unbindPageEvents } from '../../core/store/bus';
import { ArticleRow, RowInputs, SortMode, buildRows } from './listLogic';

interface TagOption {
  uuid: string;
  name: string;
  selected: boolean;
}

let offTheme: (() => void) | null = null;

function syncTabBar(page: unknown, selected: number): void {
  const tb = (page as { getTabBar?: () => { setData: (d: Record<string, unknown>) => void } | undefined }).getTabBar?.();
  if (tb) tb.setData({ selected });
}

Page({
  data: {
    themeStyle: '',
    rows: [] as ArticleRow[],
    tags: [] as TagOption[],
    sortMode: 'updated' as SortMode,
    sortOptions: [
      { value: 'updated', label: '最近更新' },
      { value: 'created', label: '创建时间' },
      { value: 'accuracy', label: '正确率' },
    ],
    showHidden: false,
    hiddenCount: 0,
    totalCount: 0,
    tagFilter: [] as string[],

    // 批量选择
    selectMode: false,
    selected: [] as string[],
    selectedCount: 0,

    // 编辑弹窗
    editing: false,
    editUuid: '',
    editTitle: '',
    editAuthor: '',
  },

  onLoad() {
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
    bindPageEvents(this as unknown as PageLike, {
      [EVT.articlesChanged]: () => this.refresh(),
      [EVT.tagsChanged]: () => this.refresh(),
    });
    this.refresh();
  },

  onShow() {
    syncTabBar(this, 1);
    this.refresh();
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
    unbindPageEvents(this as unknown as PageLike);
  },

  // ---------------- 数据 ----------------

  refresh() {
    const settings = getSettings();
    const articles = articleStore.list();
    const tagList = tagStore.list().slice().sort((a, b) => a.order - b.order);
    // 批量取数：一次构建索引（避免 buildRows 内对每篇文章重复全表扫描）
    const tagBuckets = tagsByArticle();
    const statBuckets = statsByArticle();
    const inputs: RowInputs = {
      articles,
      hidden: settings.hiddenArticles || [],
      showHidden: this.data.showHidden,
      tagFilter: this.data.tagFilter,
      sortMode: this.data.sortMode,
      selected: this.data.selected,
      tagsOf: (uuid: string) =>
        (tagBuckets.get(uuid) || []).map((t) => ({ uuid: t.uuid, name: t.name })),
      accuracyOf: (uuid: string) => {
        const s = statBuckets.get(uuid);
        return s && s.totalBlanks > 0 ? s.correctCount / s.totalBlanks : 0;
      },
    };
    this.setData({
      rows: buildRows(inputs),
      tags: tagList.map((t) => ({
        uuid: t.uuid,
        name: t.name,
        selected: this.data.tagFilter.indexOf(t.uuid) >= 0,
      })),
      hiddenCount: (settings.hiddenArticles || []).length,
      totalCount: articles.length,
      selectedCount: this.data.selected.length,
    });
  },

  // ---------------- 顶部入口 ----------------

  onOpenSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  onOpenImport() {
    wx.navigateTo({ url: '/pages/import/index' });
  },

  // ---------------- 筛选 / 排序 ----------------

  onTapTag(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid || '');
    if (!uuid) return;
    const cur = this.data.tagFilter.slice();
    const idx = cur.indexOf(uuid);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(uuid);
    this.setData({ tagFilter: cur });
    this.refresh();
  },

  onClearTags() {
    this.setData({ tagFilter: [] });
    this.refresh();
  },

  onSelectSort(e: WechatMiniprogram.TouchEvent) {
    this.setData({ sortMode: String(e.currentTarget.dataset.mode || 'updated') as SortMode });
    this.refresh();
  },

  onToggleShowHidden() {
    this.setData({ showHidden: !this.data.showHidden });
    this.refresh();
  },

  // ---------------- 文章操作 ----------------

  /** 点击进入练习（练习页负责模式选择） */
  onTapArticle(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid || '');
    if (!uuid) return;
    if (this.data.selectMode) {
      this.toggleSelect(uuid);
      return;
    }
    wx.navigateTo({ url: `/pages/practice/index?articleUuid=${uuid}&mode=SENTENCE` });
  },

  onLongPressArticle(e: WechatMiniprogram.TouchEvent) {
    this.openActions(String(e.currentTarget.dataset.uuid || ''));
  },

  onMoreArticle(e: WechatMiniprogram.TouchEvent) {
    this.openActions(String(e.currentTarget.dataset.uuid || ''));
  },

  openActions(uuid: string) {
    if (!uuid) return;
    if (this.data.selectMode) {
      this.toggleSelect(uuid);
      return;
    }
    const hidden = (getSettings().hiddenArticles || []).indexOf(uuid) >= 0;
    wx.showActionSheet({
      itemList: ['编辑标题/作者', hidden ? '取消隐藏' : '隐藏文章', '删除文章'],
      success: (res) => {
        if (res.tapIndex === 0) this.openEdit(uuid);
        else if (res.tapIndex === 1) this.toggleHidden(uuid);
        else if (res.tapIndex === 2) this.confirmDelete(uuid);
      },
      fail: () => undefined,
    });
  },

  // ---------------- 隐藏 ----------------

  toggleHidden(uuid: string) {
    const cur = (getSettings().hiddenArticles || []).slice();
    const idx = cur.indexOf(uuid);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(uuid);
    updateSettings({ hiddenArticles: cur });
    this.refresh();
    wx.showToast({ title: idx >= 0 ? '已取消隐藏' : '已隐藏', icon: 'none' });
  },

  // ---------------- 编辑标题 / 作者 ----------------

  openEdit(uuid: string) {
    const article = articleStore.find(uuid);
    if (!article) return;
    this.setData({ editing: true, editUuid: uuid, editTitle: article.title, editAuthor: article.author || '' });
  },

  onEditTitleInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ editTitle: e.detail.value });
  },

  onEditAuthorInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ editAuthor: e.detail.value });
  },

  cancelEdit() {
    this.setData({ editing: false, editUuid: '' });
  },

  saveEdit() {
    const title = this.data.editTitle.trim() || '未命名';
    updateArticle(this.data.editUuid, { title, author: this.data.editAuthor.trim() });
    emit(EVT.articlesChanged);
    this.setData({ editing: false, editUuid: '' });
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  // ---------------- 删除 ----------------

  confirmDelete(uuid: string) {
    const article = articleStore.find(uuid);
    wx.showModal({
      title: '删除文章',
      content: `确定删除「${article ? article.title : ''}」吗？关联的练习记录会保留用于统计。`,
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return;
        deleteArticleCascade(uuid);
        const selected = this.data.selected.filter((id) => id !== uuid);
        this.setData({ selected });
        emit(EVT.articlesChanged);
        this.refresh();
        wx.showToast({ title: '已删除', icon: 'success' });
      },
    });
  },

  // ---------------- 批量选择 ----------------

  onToggleSelectMode() {
    const next = !this.data.selectMode;
    this.setData({ selectMode: next, selected: next ? this.data.selected : [] });
    this.refresh();
  },

  toggleSelect(uuid: string) {
    const selected = this.data.selected.slice();
    const idx = selected.indexOf(uuid);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push(uuid);
    this.setData({ selected });
    this.refresh();
  },

  /** 跨文复习：进入练习页（多篇混编） */
  onBulkCross() {
    const uuids = this.data.selected.slice();
    if (uuids.length < 2) {
      wx.showToast({ title: '跨文复习至少选择 2 篇', icon: 'none' });
      return;
    }
    if (uuids.length > 8) {
      wx.showToast({ title: '一次最多混编 8 篇', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/practice/index?articleUuids=${uuids.join(',')}&mode=SENTENCE` });
  },

  /** 问 AI：带选中文章作为上下文进入 AI 对话 */
  onBulkAskAi() {
    const uuids = this.data.selected.slice();
    if (uuids.length === 0) {
      wx.showToast({ title: '请先选择文章', icon: 'none' });
      return;
    }
    if (uuids.length > 3) {
      wx.showToast({ title: 'AI 上下文最多 3 篇', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/packages/ai/pages/ai/index?ids=${uuids.join(',')}` });
  },

  onBulkDelete() {
    const uuids = this.data.selected.slice();
    if (uuids.length === 0) {
      wx.showToast({ title: '请先选择文章', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量删除',
      content: `确定删除选中的 ${uuids.length} 篇文章吗？此操作不可撤销。`,
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return;
        for (const uuid of uuids) deleteArticleCascade(uuid);
        this.setData({ selected: [], selectMode: false });
        emit(EVT.articlesChanged);
        this.refresh();
        wx.showToast({ title: `已删除 ${uuids.length} 篇`, icon: 'success' });
      },
    });
  },
});