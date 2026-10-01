import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from './app-config';

/** 全局配置模块：把 env 解析为强类型对象，注入 token = APP_CONFIG */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadAppConfig }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}