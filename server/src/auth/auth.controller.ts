import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CurrentUser, PlatformCtx, Public, RawRequest } from '../common/decorators';
import { AppError } from '../common/errors';
import { parseZod } from '../common/zod.util';
import type { AuthRequest, AuthUser, Platform } from '../common/types';
import {
  deleteAccountSchema,
  loginSchema,
  patchMeSchema,
  type DeleteAccountBody,
  type PatchMeBody,
} from './auth.dto';
import { AuthService } from './auth.service';

/** 认证：POST /auth/login | /auth/refresh | /auth/logout */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: unknown, @PlatformCtx() headerPlatform: Platform) {
    const parsed = parseZod(loginSchema, body);
    // body.platform（wx.getSystemInfo 结果）优先，其次请求头 X-Platform
    const platform = parsed.platform ?? headerPlatform;
    return this.auth.login(parsed.code, platform);
  }

  @Post('refresh')
  async refresh(@CurrentUser() user: AuthUser, @RawRequest() req: AuthRequest) {
    if (!user || !req.sessionToken) throw AppError.unauthorized();
    return this.auth.refresh(user.id, req.sessionToken);
  }

  @Post('logout')
  async logout(@RawRequest() req: AuthRequest) {
    if (!req.sessionToken) return { loggedOut: true };
    return this.auth.logout(req.sessionToken);
  }
}

/** 用户资料：GET /me | PATCH /me | POST /me/delete */
@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user.id);
  }

  @Patch()
  async patch(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed: PatchMeBody = parseZod(patchMeSchema, body);
    return this.auth.patchMe(user.id, parsed);
  }

  @Post('delete')
  async remove(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    parseZod(deleteAccountSchema, body) as DeleteAccountBody;
    return this.auth.deleteAccount(user.id);
  }
}