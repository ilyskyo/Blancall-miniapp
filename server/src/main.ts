import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger';
import type { AuthRequest } from './common/types';
import { isAiConfigured, loadAppConfig } from './config/app-config';

// BigInt 无法被 JSON.stringify 直接序列化（entities.rev / space_bytes 等），统一转 number
// 注：数值均在 2^53 安全范围内（rev 为序列值、空间为字节数）
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(this: bigint): number {
  return Number(this);
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.useLogger(app.get(AppLogger));

  // 自定义 body parser：仅为支付回调保留原始报文（用于 RSA 验签）
  app.use(
    json({
      limit: '25mb',
      verify: (req, _res, buf) => {
        const url = (req as unknown as { originalUrl?: string }).originalUrl ?? '';
        if (url.includes('/pay/notify')) {
          (req as unknown as AuthRequest).rawBody = buf.toString('utf8');
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // 统一前缀（与接口规范 Base URL https://<api-host>/api/v1 一致）
  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,X-Platform,X-Admin-Token',
    exposedHeaders: 'Content-Length,Content-Type',
    credentials: false,
  });

  app.enableShutdownHooks();

  const cfg = loadAppConfig();
  await app.listen(cfg.port, '0.0.0.0');

  const logger = new AppLogger();
  logger.log(`Blancall API 已启动：http://0.0.0.0:${cfg.port}/api/v1（${cfg.nodeEnv}）`, 'Bootstrap');
  logger.log(
    `对象存储：${cfg.storage.driver}｜微信登录：${cfg.wx.devLogin ? 'DEV_LOGIN(mock)' : 'code2session'}｜` +
      `内容安全：${cfg.wxSecurity.enabled ? '已启用' : '未配置(securitySkipped)'}｜` +
      `AI 上游：${isAiConfigured(cfg) ? '已配置' : '未配置'}`,
    'Bootstrap',
  );
  if (cfg.isProd) {
    if (!cfg.wxSecurity.enabled) logger.warn('生产环境未启用内容安全检测，审核存在风险！', 'Bootstrap');
    if (cfg.storage.urlSecret.includes('please-change')) {
      logger.warn('生产环境未修改 STORAGE_URL_SECRET，请更换为随机长字符串！', 'Bootstrap');
    }
  }
}

void bootstrap();