import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { extractAdminToken } from './bearer.util';
import { AppError } from './errors';
import { IS_ADMIN_KEY } from './meta';
import type { AuthRequest } from './types';

/**
 * 管理员守卫（全局）：读取 @AdminOnly() 元数据，
 * 校验 X-Admin-Token / Bearer 是否等于 ADMIN_TOKEN。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const need = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!need) return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractAdminToken(req);
    if (this.cfg.adminToken && token && token === this.cfg.adminToken) return true;
    throw AppError.forbidden('需要管理员权限');
  }
}
