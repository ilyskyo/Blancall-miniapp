/**
 * 素材库辅助逻辑（列表构建 / 免责声明 / 启停 / 缓存读写的错误口径）
 */

import { LIBRARIES } from '../../core/config';
import {
  LIBRARY_DISCLAIMER,
  LibraryItem,
  LibraryText,
  importToArticle,
  loadIndex,
  loadText,
} from '../../core/library/gaokao';
import { getSettings, updateSettings } from '../../core/storage/prefs';

export interface LibraryCard {
  key: string;
  name: string;
  subtitle: string;
  note: string;
  enabled: boolean;
}

/** 构建素材库卡片（当前仅 gaokao） */
export function buildCards(): LibraryCard[] {
  const keys = getSettings().builtInLibraryKeys || [];
  return LIBRARIES.map((l) => ({
    key: l.key,
    name: l.name,
    subtitle: '高考语文必背 60 篇',
    note: '仅文本',
    enabled: keys.includes(l.key),
  }));
}

/** 是否已确认免责声明 */
export function disclaimerSeen(key = 'gaokao'): boolean {
  return (getSettings().libraryDisclaimerSeen || []).includes(key);
}

/** 记录免责声明已确认 */
export function markDisclaimerSeen(key = 'gaokao'): void {
  const cur = getSettings().libraryDisclaimerSeen || [];
  if (!cur.includes(key)) updateSettings({ libraryDisclaimerSeen: [...cur, key] });
}

/** 启用/停用某内置库 */
export function setLibraryEnabled(key: string, enabled: boolean): void {
  const cur = getSettings().builtInLibraryKeys || [];
  const next = enabled ? Array.from(new Set([...cur, key])) : cur.filter((k) => k !== key);
  updateSettings({ builtInLibraryKeys: next });
}

export { LIBRARY_DISCLAIMER, importToArticle, loadIndex, loadText };
export type { LibraryItem, LibraryText };