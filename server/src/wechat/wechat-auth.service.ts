import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { httpFetchWithTimeout } from '../common/http';

export interface Code2SessionResult {
  openid: string;
  unionid?: string;
}

/** 微信登录：code2session；未配置 AppID/Secret 时自动降级为稳定的 mock openid */
@Injectable()
export class WechatAuthService {
  private readonly logger = new Logger(WechatAuthService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** 是否处于开发登录模式 */
  get isDevMode(): boolean {
    return this.cfg.wx.devLogin || !this.cfg.wx.appId || !this.cfg.wx.secret;
  }

  async code2Session(code: string): Promise<Code2SessionResult> {
    if (this.isDevMode) {
      const openid = `dev_${createHash('sha1').update(code).digest('hex')}`;
      this.logger.warn(`DEV_LOGIN 生效：为 code 生成 mock openid，生产环境必须配置 WX_APPID/WX_SECRET`);
      return { openid };
    }

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(this.cfg.wx.appId)}` +
      `&secret=${encodeURIComponent(this.cfg.wx.secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    const res = await httpFetchWithTimeout(url, { method: 'GET' }, 10000);
    if (!res.ok) throw AppError.upstreamFailed(`code2session HTTP ${res.status}`);
    const data = (await res.json()) as { openid?: string; unionid?: string; errcode?: number; errmsg?: string };

    if (data.errcode || !data.openid) {
      throw AppError.upstreamFailed(`code2session 失败：${data.errcode ?? ''} ${data.errmsg ?? '未知错误'}`);
    }
    return { openid: data.openid, unionid: data.unionid };
  }
}