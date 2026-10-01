import { Injectable, Logger } from '@nestjs/common';
import { httpFetchWithTimeout } from '../common/http';
import { WechatTokenService } from './wechat-token.service';

export interface SubscribeMessageResult {
  ok: boolean;
  errcode?: number;
  errmsg?: string;
  msgid?: string;
}

/**
 * 微信订阅消息发送（小程序 subscribeMessage.send）
 * - 一次性订阅：用户每授权一次，服务端可发一条；次数由客户端囤积，
 *   服务端不做次数强校验，仅在 reminder_sent_logs 记录发送结果。
 * - 未配置模板 ID 时不调用本服务。
 */
@Injectable()
export class WechatSubscribeService {
  private readonly logger = new Logger(WechatSubscribeService.name);

  constructor(private readonly token: WechatTokenService) {}

  get configured(): boolean {
    return this.token.configured;
  }

  /**
   * @param openid     接收者 openid
   * @param templateId 订阅消息模板 ID
   * @param page       点击跳转的小程序页面
   * @param data       模板数据（键名须与申请的模板字段一致）
   */
  async sendSubscribeMessage(input: {
    openid: string;
    templateId: string;
    page?: string;
    data: Record<string, { value: string | number }>;
  }): Promise<SubscribeMessageResult> {
    const accessToken = await this.token.getAccessToken();

    const body = JSON.stringify({
      touser: input.openid,
      template_id: input.templateId,
      page: input.page ?? 'pages/home/home',
      // 不传 miniprogram_state（默认 formal）：该字段需与用户所在小程序版本一致，
      // 误传 'trial'/'developer' 会导致正式版用户收不到消息。
      lang: 'zh_CN',
      data: input.data,
    });

    const res = await httpFetchWithTimeout(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
      10000,
    );

    if (!res.ok) {
      this.logger.warn(`订阅消息发送 HTTP ${res.status}`);
      return { ok: false, errcode: res.status, errmsg: `HTTP ${res.status}` };
    }

    const result = (await res.json()) as { errcode?: number; errmsg?: string; msgid?: string };
    const errcode = result.errcode ?? 0;
    if (errcode !== 0) {
      // 常见：43101 用户拒绝接收/次数用尽；40003 openid 错误；47003 模板参数不准确
      this.logger.warn(`订阅消息发送失败 errcode=${errcode} errmsg=${result.errmsg ?? ''}`);
      return { ok: false, errcode, errmsg: result.errmsg };
    }

    return { ok: true, errcode: 0, errmsg: result.errmsg, msgid: result.msgid };
  }
}