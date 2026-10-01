import { z } from 'zod';

/** 可同步实体（docs/02-接口规范.md §3） */
export const ENTITIES = [
  'article',
  'tag',
  'tag_link',
  'practice_record',
  'practice_state',
  'fsrs',
  'custom_cloze',
  'mask_config',
  'reader_prefs',
  'home_layout',
  'app_settings',
  'study_stat',
] as const;

export type EntityName = (typeof ENTITIES)[number];

export const syncOpSchema = z.object({
  entity: z.enum(ENTITIES),
  op: z.enum(['upsert', 'delete']),
  uuid: z.string().min(1).max(256),
  /** 客户端生成的更新时间：毫秒时间戳或 ISO 字符串 */
  updatedAt: z.union([z.number(), z.string()]).optional(),
  payload: z.unknown().optional(),
});

export const syncPushSchema = z.object({
  deviceId: z.string().max(128).optional(),
  ops: z.array(syncOpSchema).min(1, 'ops 不能为空').max(1000, '单次最多 1000 条操作'),
});

export type SyncPushBody = z.infer<typeof syncPushSchema>;
export type SyncOp = z.infer<typeof syncOpSchema>;

export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1000;