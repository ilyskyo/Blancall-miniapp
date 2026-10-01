import { Global, Module } from '@nestjs/common';
import { WechatAuthService } from './wechat-auth.service';
import { WechatSecurityService } from './wechat-security.service';
import { WechatSubscribeService } from './wechat-subscribe.service';
import { WechatTokenService } from './wechat-token.service';

/** 微信能力（登录 / 内容安全 / 订阅消息 / 支付）——全局可用 */
@Global()
@Module({
  providers: [
    WechatTokenService,
    WechatAuthService,
    WechatSecurityService,
    WechatSubscribeService,
  ],
  exports: [
    WechatTokenService,
    WechatAuthService,
    WechatSecurityService,
    WechatSubscribeService,
  ],
})
export class WechatModule {}