import { z, ZodTypeAny } from 'zod';
import { AppError } from './errors';

/** 用 zod 校验并返回强类型结果；失败抛 INVALID_ARGUMENT（携带 issues） */
export function parseZod<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.invalidArgument(undefined, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return result.data as z.infer<T>;
}

export { z };