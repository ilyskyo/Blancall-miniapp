/**
 * 「我的文章」列表纯逻辑：筛选（标签/隐藏）→ 排序 → 生成渲染行
 * WXML 不支持函数调用，摘要/时间/正确率等派生字段都在这里算好。
 */

import { ArticleEntity } from '../../core/algorithms/types';
import { formatShort } from '../../core/utils/date';

export type SortMode = 'updated' | 'created' | 'accuracy';

export interface ArticleRow {
  uuid: string;
  title: string;
  excerpt: string;
  tagNames: string[];
  timeText: string;
  accuracyText: string;
  hidden: boolean;
  selected: boolean;
}

export interface RowInputs {
  articles: ArticleEntity[];
  /** settings.hiddenArticles */
  hidden: string[];
  /** 是否显示被隐藏的文章 */
  showHidden: boolean;
  /** 已选标签 uuid（空 = 不筛选；多选取「任一命中」） */
  tagFilter: string[];
  sortMode: SortMode;
  selected: string[];
  tagsOf: (articleUuid: string) => Array<{ uuid: string; name: string }>;
  accuracyOf: (articleUuid: string) => number;
}

/** 正文摘要：折叠空白取前 90 字 */
export function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

export function buildRows(inputs: RowInputs): ArticleRow[] {
  const hiddenSet = new Set(inputs.hidden);
  const selectedSet = new Set(inputs.selected);
  const filtered = inputs.articles.filter((a) => {
    if (!inputs.showHidden && hiddenSet.has(a.uuid)) return false;
    if (inputs.tagFilter.length > 0) {
      const owned = inputs.tagsOf(a.uuid).map((t) => t.uuid);
      if (!inputs.tagFilter.some((t) => owned.indexOf(t) >= 0)) return false;
    }
    return true;
  });

  const sorted = filtered.slice().sort((a, b) => {
    if (inputs.sortMode === 'created') return b.createdAt - a.createdAt;
    if (inputs.sortMode === 'accuracy') return inputs.accuracyOf(b.uuid) - inputs.accuracyOf(a.uuid);
    return b.updatedAt - a.updatedAt;
  });

  return sorted.map((a) => ({
    uuid: a.uuid,
    title: a.title,
    excerpt: excerptOf(a.content),
    tagNames: inputs.tagsOf(a.uuid).slice(0, 3).map((t) => t.name),
    timeText:
      inputs.sortMode === 'created' ? `创建 ${formatShort(a.createdAt)}` : `更新 ${formatShort(a.updatedAt)}`,
    accuracyText: `${Math.round(inputs.accuracyOf(a.uuid) * 100)}%`,
    hidden: hiddenSet.has(a.uuid),
    selected: selectedSet.has(a.uuid),
  }));
}