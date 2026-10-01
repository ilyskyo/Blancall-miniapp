import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { httpFetchWithTimeout } from '../common/http';
import { WechatTokenService } from './wechat-token.service';

export interface SecurityCheckResult {
  /** 是否通过 */
  pass: boolean;
  /** 是否因未配置而跳过（生产必须为 false） */
  skipped: boolean;
  /** 微信返回的风险标签（可选） */
  label?: number;
  /** 微信返回的 suggest：pass | review | risky */
  suggest?: string;
}

/**
 * 微信内容安全（security.msgSecCheck v2）
 * - 未配置（WX_SECURITY_ENABLED=false 或 缺少 AppID/Secret）→ 直接放行，响应中标注 securitySkipped=true
 * - 配置后失败 → 抛 UPSTREAM_FAILED（不静默放行）
 *
 * ⚠️ 生产环境必须配置 WX_APPID/WX_SECRET 并开启 WX_SECURITY_ENABLED，
 *    否则用户上传文本与 AI 输入输出将不做合规检测（审核不通过风险）。
 */
@Injectable()
export class WechatSecurityService {
  private readonly logger = new Logger(WechatSecurityService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly token: WechatTokenService,
  ) {}

  get enabled(): boolean {
    return this.cfg.wxSecurity.enabled && this.token.configured;
  }

  private getAccessToken(): Promise<string> {
    return this.token.getAccessToken();
  }

  /**
   * 文本送检
   * @param content 待检文本（微信限制 2500 字，超长自动截断）
   * @param openid  用户 openid（v2 要求，用于场景追溯）
   */
  async checkText(content: string, openid?: string): Promise<SecurityCheckResult> {
    if (!this.enabled) {
      this.logger.warn('内容安全未配置，已跳过 msgSecCheck（securitySkipped=true）');
      return { pass: true, skipped: true };
    }
    if (!content || content.trim() === '') return { pass: true, skipped: false };

    const token = await this.getAccessToken();
    const payload = {
      content: content.slice(0, 2500),
      version: 2,
      scene: this.cfg.wxSecurity.scene,
      ...(openid ? { openid } : {}),
    };
    const res = await httpFetchWithTimeout(
      `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      10000,
    );
    if (!res.ok) throw AppError.upstreamFailed(`msgSecCheck HTTP ${res.status}`);
    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      result?: { suggest?: string; label?: number };
      detail?: unknown;
    };

    if (data.errcode && data.errcode !== 0) {
      throw AppError.upstreamFailed(`msgSecCheck 失败：${data.errcode} ${data.errmsg ?? ''}`);
    }
    const suggest = data.result?.suggest ?? 'pass';
    return {
      pass: suggest === 'pass',
      skipped: false,
      suggest,
      label: data.result?.label,
    };
  }

  /** 送检并在不通过时抛 CONTENT_REJECTED */
  async assertText(content: string, openid?: string): Promise<SecurityCheckResult> {
    const result = await this.checkText(content, openid);
    if (!result.pass) throw AppError.contentRejected();
    return result;
  }
}