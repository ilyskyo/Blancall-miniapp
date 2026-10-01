import { z } from 'zod';

export const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        ts: z.number().optional(),
        props: z.unknown().optional(),
      }),
    )
    .min(1, 'events 不能为空')
    .max(200),
});
export type EventsBody = z.infer<typeof eventsSchema>;

export const errorSchema = z.object({
  message: z.string().min(1).max(2000),
  // 公开接口：栈只保留前 4000 字符，避免匿名刷量放大写入
  stack: z.string().max(4000).optional(),
  page: z.string().max(256).optional(),
  ua: z.string().max(512).optional(),
  ts: z.number().optional(),
});
export type ErrorBody = z.infer<typeof errorSchema>;