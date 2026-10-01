import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { FEATURE_META_KEY, IS_ADMIN_KEY, IS_PUBLIC_KEY, SKIP_WRAP_KEY } from './meta';
import type { AuthRequest, AuthUser, Platform } from './types';

/** 标记为公开接口（跳过登录校验，但仍会尝试解析 token） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 跳过统一响应包装（用于分块/原始响应） */
export const SkipResponseWrap = () => SetMetadata(SKIP_WRAP_KEY, true);

/** 声明接口所需功能权益 */
export const RequireFeature = (...features: string[]) => SetMetadata(FEATURE_META_KEY, features);

/** 标记为管理员接口（需 X-Admin-Token 或 Bearer == ADMIN_TOKEN） */
export const AdminOnly = () => SetMetadata(IS_ADMIN_KEY, true);

/** 注入当前登录用户（可能为 undefined） */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  const req = ctx.switchToHttp().getRequest<AuthRequest>();
  return req.user;
});

/** 注入当前请求平台 */
export const PlatformCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): Platform => {
  const req = ctx.switchToHttp().getRequest<AuthRequest>();
  return req.platform;
});

/** 注入原始请求对象 */
export const RawRequest = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthRequest => {
  return ctx.switchToHttp().getRequest<AuthRequest>();
});