import { z } from 'zod';

export const csvSchema = z.object({
  filter: z
    .object({
      articleUuid: z.string().max(128).optional(),
      /** 起始时间（毫秒时间戳） */
      from: z.number().optional(),
      /** 结束时间（毫秒时间戳） */
      to: z.number().optional(),
    })
    .optional(),
});
export type CsvBody = z.infer<typeof csvSchema>;

export const pdfSchema = z.object({
  articleUuid: z.string().min(1).max(128),
  mode: z.enum(['SENTENCE', 'WORD', 'REVERSE']).optional().default('WORD'),
  includeAnswers: z.boolean().optional().default(true),
});
export type PdfBody = z.infer<typeof pdfSchema>;

/** 备份无参数 */
export const backupSchema = z.object({}).passthrough().optional();