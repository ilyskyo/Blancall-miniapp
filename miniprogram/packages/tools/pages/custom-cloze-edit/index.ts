/**
 * 自定义挖空编辑：点击字符区间挖空、长按 句→词→字 循环拆解、撤销/重做（20）、按句全选、保存
 * 坐标口径与练习引擎一致（SentenceSplitter.split 的句索引 + 句内半开区间）。
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { SentenceSplitter } from '../../../../core/algorithms/sentence';
import { CustomClozeEntity, articleStore, customClozeOfArticle, customClozeStore } from '../../../../core/storage/entities';
import { PracticeMode } from '../../../../core/algorithms/types';
import { md5Hex } from '../../../../core/utils/digest';
import { uuidv7 } from '../../../../core/utils/uuid';
import {
  clearDraft,
  promptRestoreDraft,
  scheduleDraft,
} from '../../../../core/editor/draft';
import {
  GRANULARITY_LABEL,
  SentenceView,
  blankAt,
  buildSentenceViews,
  clauseOf,
  nextGranularity,
  pushBounded,
  snapshot,
  toggleAllSentences,
  unitsForClause,
} from './indexLogic';

let offTheme: (() => void) | null = null;

/** 草稿键：按文章隔离（iOS 未保存离开的兜底存储） */
function draftKey(): string {
  return `custom_cloze:${articleUuid}`;
}

// ---------- 页面级可变状态（不触发渲染的数据放模块级，减少 setData） ----------
let content = '';
let sentences: string[] = [];
let blanks: Array<{ s: number; a: number; b: number }> = [];
let undoStack: Array<Array<{ s: number; a: number; b: number }>> = [];
let redoStack: Array<Array<{ s: number; a: number; b: number }>> = [];
let pending: { s: number; a: number } | null = null;
let dirty = false;

let articleUuid = '';
let configUuid = '';
let configMode: PracticeMode = 'SENTENCE';
let configLevels: number[] = [];
let configCreatedAt = 0;

/** 返回拦截（基础库差异，安全调用） */
function setUnloadGuard(message: string | null): void {
  const w = wx as unknown as {
    enableAlertBeforeUnload?: (opt: { message: string }) => void;
    disableAlertBeforeUnload?: () => void;
  };
  try {
    if (message && w.enableAlertBeforeUnload) w.enableAlertBeforeUnload({ message });
    else if (w.disableAlertBeforeUnload) w.disableAlertBeforeUnload();
  } catch {
    /* 忽略 */
  }
}

Page({
  data: {
    themeStyle: '',
    articleTitle: '',
    name: '',
    /** 限时免费活动：展示灰色小按键 */
    sentences: [] as SentenceView[],
    blankCount: 0,
    canUndo: false,
    canRedo: false,
    dirtyText: '已保存',
  },

  onLoad(query: Record<string, string>) {
    articleUuid = query.articleUuid || '';
    const article = articleStore.find(articleUuid);
    if (!article) {
      wx.showToast({ title: '文章不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    content = article.content;
    sentences = SentenceSplitter.split(content);
    blanks = [];
    undoStack = [];
    redoStack = [];
    pending = null;
    dirty = false;

    const configId = query.configId || '';
    const existing = configId ? customClozeOfArticle(articleUuid).find((c) => c.uuid === configId) || null : null;
    if (existing) {
      configUuid = existing.uuid;
      configMode = existing.mode;
      configLevels = existing.levels || [];
      configCreatedAt = existing.createdAt;
      blanks = snapshot(existing.blanks || []);
      if (existing.contentHash && existing.contentHash !== md5Hex(content)) {
        setTimeout(
          () => wx.showToast({ title: '文章已修改，配置位置可能失准', icon: 'none', duration: 2600 }),
          350
        );
      }
    } else {
      configUuid = '';
      configMode = 'SENTENCE';
      configLevels = [];
      configCreatedAt = 0;
    }

    const name = existing ? existing.name : `配置 ${customClozeOfArticle(articleUuid).length + 1}`;
    this.setData({ themeStyle: themeStyle(), articleTitle: article.title, name });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
    this.refresh();

    // iOS 兜底：wx.enableAlertBeforeUnload 仅 Android 生效，iOS 用草稿暂存避免编辑丢失
    promptRestoreDraft<{ blanks: Array<{ s: number; a: number; b: number }>; name: string }>(
      draftKey(),
      '自定义挖空编辑',
      (data) => {
        blanks = snapshot(data.blanks || []);
        undoStack = [];
        redoStack = [];
        dirty = true;
        if (data.name) this.setData({ name: data.name });
        this.refresh();
        wx.showToast({ title: '已恢复未保存的编辑', icon: 'success' });
      }
    );
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
      sentences: buildSentenceViews(sentences, blanks, pending),
      blankCount: blanks.length,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      dirtyText: dirty ? '未保存' : '已保存',
    });
    setUnloadGuard(dirty ? '有未保存的修改，确定离开？' : null);
    // iOS 兜底：变更即防抖写草稿（Android 走系统拦截，helper 内部会跳过）
    if (dirty) {
      scheduleDraft(draftKey(), () => ({ blanks: snapshot(blanks), name: this.data.name }));
    }
  },

  pushUndo() {
    pushBounded(undoStack, snapshot(blanks));
    redoStack = [];
    dirty = true;
  },

  // ============================== 交互 ==============================

  onNameInput(e: WechatMiniprogram.Input) {
    dirty = true;
    this.setData({ name: e.detail.value, dirtyText: '未保存' });
  },

  onTapChar(e: WechatMiniprogram.TouchEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const ci = Number(e.currentTarget.dataset.ci);
    const hit = blankAt(blanks, si, ci);

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

  onLongPress(e: WechatMiniprogram.TouchEvent) {
    const si = Number(e.currentTarget.dataset.si);
    const ci = Number(e.currentTarget.dataset.ci);
    const sentence = sentences[si] || '';
    if (!sentence) return;
    const clause = clauseOf(sentence, ci);
    const level = nextGranularity(blanks, si, sentence, clause);
    this.pushUndo();
    blanks = blanks.filter((b) => !(b.s === si && b.a >= clause.start && b.b <= clause.end));
    const units = unitsForClause(sentence, clause, level);
    blanks = blanks.concat(units.map((u) => ({ s: si, a: u.start, b: u.end })));
    pending = null;
    this.refresh();
    wx.showToast({ title: `已按${GRANULARITY_LABEL[level]}拆解`, icon: 'none' });
  },

  onUndo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshot(blanks));
    blanks = undoStack.pop() as Array<{ s: number; a: number; b: number }>;
    pending = null;
    this.refresh();
  },

  onRedo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshot(blanks));
    blanks = redoStack.pop() as Array<{ s: number; a: number; b: number }>;
    pending = null;
    this.refresh();
  },

  onClear() {
    if (blanks.length === 0) return;
    this.pushUndo();
    blanks = [];
    pending = null;
    this.refresh();
  },

  onSelectAll() {
    this.pushUndo();
    blanks = toggleAllSentences(sentences, blanks);
    pending = null;
    this.refresh();
  },

  // ============================== 保存 ==============================

  onSave() {
    const name = (this.data.name || '').trim() || '未命名配置';
    try {
      const entity: CustomClozeEntity = {
        uuid: configUuid || uuidv7(),
        articleUuid,
        name,
        createdAt: configCreatedAt || Date.now(),
        mode: configMode,
        levels: configLevels,
        contentHash: md5Hex(content),
        blanks: snapshot(blanks),
        updatedAt: Date.now(),
      };
      customClozeStore.upsert(entity);
      configUuid = entity.uuid;
      configCreatedAt = entity.createdAt;
      dirty = false;
      clearDraft(draftKey());
      setUnloadGuard(null);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
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