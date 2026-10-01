import type { Request } from 'express';
import type { User } from '@prisma/client';

export type Platform = 'android' | 'ios' | 'devtools';

/** 已登录用户（Prisma User 实体） */
export type AuthUser = User;

/** 带上下文的请求对象（由 PlatformMiddleware / AuthGuard 注入） */
export interface AuthRequest extends Request {
  user?: User;
  sessionToken?: string;
  platform: Platform;
  /** 由 express.json({ verify }) 捕获的原始请求体，用于支付回调验签 */
  rawBody?: string;
}