import type { User } from '@prisma/client';
import { z } from 'zod';

/** 对外用户资料结构（GET /me、登录返回） */
export interface UserView {
  id: string;
  nickname: string | null;
  avatar: string | null;
  rankVisible: boolean;
  createdAt: number;
}

export function toUserView(user: User): UserView {
  return {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    rankVisible: user.rankVisible,
    createdAt: user.createdAt.getTime(),
  };
}

export const PLATFORMS = ['android', 'ios', 'devtools'] as const;

export const loginSchema = z.object({
  code: z.string().min(1, '缺少 code'),
  platform: z.enum(PLATFORMS).optional(),
});
export type LoginBody = z.infer<typeof loginSchema>;

export const patchMeSchema = z
  .object({
    nickname: z.string().max(64).optional(),
    avatar: z.string().max(2048).optional(),
    rankVisible: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少提供一个待更新字段' });
export type PatchMeBody = z.infer<typeof patchMeSchema>;

export const deleteAccountSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: '必须显式确认注销（confirm: true）' }),
  }),
});
export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;