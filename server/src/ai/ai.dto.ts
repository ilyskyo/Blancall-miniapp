import { z } from 'zod';

export const clozeSchema = z.object({
  articleText: z.string().min(1, '缺少 articleText').max(200000),
  mode: z.enum(['SENTENCE', 'WORD', 'REVERSE']),
  strategy: z.string().max(64).optional(),
  level: z.union([z.number(), z.string().max(32)]).optional(),
  extra: z.string().max(2000).optional(),
});
export type ClozeBody = z.infer<typeof clozeSchema>;

export const analysisSchema = z.object({
  title: z.string().max(200).optional(),
  mode: z.string().max(32).optional(),
  accuracy: z.number().optional(),
  mistakes: z.array(z.unknown()).max(500).optional(),
  weakHints: z.unknown().optional(),
  strongHints: z.unknown().optional(),
});
export type AnalysisBody = z.infer<typeof analysisSchema>;

export const chatSchema = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  articleUuids: z.array(z.string().min(1).max(128)).max(50).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1).max(20000),
      }),
    )
    .min(1, 'messages 不能为空')
    .max(50),
});
export type ChatBody = z.infer<typeof chatSchema>;