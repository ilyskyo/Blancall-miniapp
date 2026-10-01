/**
 * 自定义挖空列表纯逻辑：配置行视图（模式文案 / 时间 / 空数）与「当前配置」本地键
 */

import { CustomClozeEntity } from '../../../../core/storage/entities';
import { PracticeMode } from '../../../../core/algorithms/types';
import { formatFull } from '../../../../core/utils/date';

export const MODE_LABELS: Record<PracticeMode, string> = {
  SENTENCE: '句子挖空',
  WORD: '字词挖空',
  REVERSE: '反向默写',
};

export interface ConfigRow {
  uuid: string;
  name: string;
  createdText: string;
  modeLabel: string;
  blankCount: number;
  activeCls: string;
  activeLabel: string;
}

/** 构建列表行（按 createdAt 升序，与存储顺序一致） */
export function buildConfigRows(configs: CustomClozeEntity[], activeUuid: string): ConfigRow[] {
  return configs.map((c) => {
    const active = c.uuid === activeUuid;
    return {
      uuid: c.uuid,
      name: c.name,
      createdText: formatFull(c.createdAt),
      modeLabel: MODE_LABELS[c.mode] || '句子挖空',
      blankCount: (c.blanks || []).length,
      activeCls: active ? 'chip' : 'chip chip--muted',
      activeLabel: active ? '当前' : '设为当前',
    };
  });
}

/** 「当前配置」本地键（练习时作为 configUuid 默认值） */
export function activeConfigKey(articleUuid: string): string {
  return `custom_cloze_active/${articleUuid}`;
}