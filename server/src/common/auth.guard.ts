import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { extractBearer } from './bearer.util';
import { AppError } from './errors';
import { IS_PUBLIC_KEY } from './meta';
import type { AuthRequest } from './types';

/**
 * 登录守卫（全局）
 * - 解析 Bearer token → 校验会话有效期 → 注入 req.user
 * - 未登录时：@Public() 接口放行，其余抛 UNAUTHORIZED
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = extractBearer(req);
    if (token) {
      const session = await this.prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });
      if (session && session.expiresAt.getTime() > Date.now() && !session.user.deletedAt) {
        req.user = session.user;
        req.sessionToken = token;
        return true;
      }
    }

    if (isPublic) return true;
    throw AppError.unauthorized();
  }
}