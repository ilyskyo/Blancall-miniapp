/**
 * 标签管理页纯逻辑：调色板 / 行视图构建 / 排序重排（无副作用）
 * 标签颜色以索引存储（TagEntity.color: number），调色板复用主题色预设，避免另立硬编码色板。
 */

import { ACCENT_PRESETS } from '../../../../core/theme/theme';
import { TagEntity } from '../../../../core/storage/entities';

/** 标签可选颜色（8 色预设，取自主题色板） */
export const TAG_PALETTE: string[] = ACCENT_PRESETS.map((p) => p.color);

/** 颜色索引 → hex（越界取模） */
export function tagColorHex(colorIndex: number): string {
  return TAG_PALETTE[colorIndex % TAG_PALETTE.length] || TAG_PALETTE[0];
}

export interface TagRow {
  uuid: string;
  name: string;
  colorIndex: number;
  colorHex: string;
  articleCount: number;
  order: number;
  upCls: string;
  downCls: string;
}

/** 由标签与文章数构建列表行（按 order 升序） */
export function buildTagRows(tags: TagEntity[], counts: Map<string, number>): TagRow[] {
  const sorted = tags.slice().sort((a, b) => a.order - b.order);
  return sorted.map((t, idx) => ({
    uuid: t.uuid,
    name: t.name,
    colorIndex: t.color,
    colorHex: tagColorHex(t.color),
    articleCount: counts.get(t.uuid) || 0,
    order: t.order,
    upCls: 'icon-btn' + (idx > 0 ? '' : ' icon-btn--off'),
    downCls: 'icon-btn' + (idx < sorted.length - 1 ? '' : ' icon-btn--off'),
  }));
}

/** 调色板行视图（编辑器用，cls 预计算避免 WXML 内联表达式） */
export function buildPaletteRows(selected: number): Array<{ color: string; index: number; cls: string }> {
  return TAG_PALETTE.map((color, index) => ({
    color,
    index,
    cls: index === selected ? 'palette__item--on' : '',
  }));
}

/** 上/下移：返回重排后的新顺序数组（越界返回原数组） */
export function moveInList<T>(list: T[], index: number, dir: number): T[] {
  const target = index + dir;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = list.slice();
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  return next;
}