/**
 * 遮罩配置列表纯逻辑：配置行视图
 */

import { MaskConfigEntity } from '../../../../core/storage/entities';
import { formatFull } from '../../../../core/utils/date';

export interface MaskRow {
  uuid: string;
  name: string;
  createdText: string;
  spanCount: number;
  chipCls: string;
  chipLabel: string;
}

export function buildMaskRows(configs: MaskConfigEntity[]): MaskRow[] {
  return configs.map((c) => ({
    uuid: c.uuid,
    name: c.name,
    createdText: formatFull(c.createdAt),
    spanCount: (c.spans || []).length,
    chipCls: c.selected ? 'chip' : 'chip chip--muted',
    chipLabel: c.selected ? '阅读生效中' : '设为生效',
  }));
}