import { Global, Module } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppLogger } from './logger';
import { ResponseInterceptor } from './response.interceptor';

/** 横切基础设施：统一响应、异常过滤、日志 */
@Global()
@Module({
  providers: [AppLogger, ResponseInterceptor, AllExceptionsFilter],
  exports: [AppLogger, ResponseInterceptor, AllExceptionsFilter],
})
export class CommonModule {}