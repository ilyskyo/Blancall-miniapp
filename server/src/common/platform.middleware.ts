import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AuthRequest, Platform } from './types';

const VALID: readonly Platform[] = ['android', 'ios', 'devtools'];

/**
 * 平台识别中间件：从请求头 X-Platform 读取 android | ios | devtools
 * 缺失或非法值统一回落为 devtools（不影响业务，仅用于 iOS 虚拟支付拦截等）
 */
@Injectable()
export class PlatformMiddleware implements NestMiddleware {
  use(req: AuthRequest, _res: Response, next: NextFunction): void {
    const raw = String(req.headers['x-platform'] ?? '').toLowerCase();
    req.platform = (VALID as readonly string[]).includes(raw) ? (raw as Platform) : 'devtools';
    next();
  }
}