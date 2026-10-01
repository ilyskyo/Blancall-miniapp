import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { httpFetchWithTimeout } from '../common/http';

/**
 * 微信接口调用凭证（access_token）统一获取与缓存
 * 供内容安全（msgSecCheck）、订阅消息（subscribeMessage.send）等复用。
 */
@Injectable()
export class WechatTokenService {
  private readonly logger = new Logger(WechatTokenService.name);
  private cache: { token: string; expireAt: number } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** AppID/AppSecret 是否齐备 */
  get configured(): boolean {
    return Boolean(this.cfg.wx.appId && this.cfg.wx.secret);
  }

  async getAccessToken(): Promise<string> {
    if (this.cache && this.cache.expireAt > Date.now() + 30_000) {
      return this.cache.token;
    }
    if (!this.configured) throw AppError.upstreamFailed('未配置 WX_APPID / WX_SECRET');

    const url =
      'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
      `&appid=${encodeURIComponent(this.cfg.wx.appId)}` +
      `&secret=${encodeURIComponent(this.cfg.wx.secret)}`;

    const res = await httpFetchWithTimeout(url, { method: 'GET' }, 10000);
    if (!res.ok) throw AppError.upstreamFailed(`获取 access_token HTTP ${res.status}`);

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!data.access_token) {
      throw AppError.upstreamFailed(`获取 access_token 失败：${data.errcode ?? ''} ${data.errmsg ?? ''}`);
    }

    this.cache = {
      token: data.access_token,
      expireAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
    this.logger.log('access_token 已刷新');
    return data.access_token;
  }
}