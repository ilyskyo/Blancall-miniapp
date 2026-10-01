import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { CheckinModule } from './checkin/checkin.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { AdminGuard } from './common/admin.guard';
import { PlatformMiddleware } from './common/platform.middleware';
import { ResponseInterceptor } from './common/response.interceptor';
import { AppConfigModule } from './config/app-config.module';
import { ExportModule } from './export/export.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { LibraryModule } from './library/library.module';
import { LogModule } from './log/log.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReminderModule } from './reminder/reminder.module';
import { SpaceModule } from './space/space.module';
import { StorageModule } from './storage/storage.module';
import { SyncModule } from './sync/sync.module';
import { UploadsModule } from './uploads/uploads.module';
import { WechatModule } from './wechat/wechat.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CommonModule,
    WechatModule,
    ScheduleModule.forRoot(),
    // 业务模块
    AuthModule,
    SyncModule,
    StorageModule,
    UploadsModule,
    SpaceModule,
    CheckinModule,
    LeaderboardModule,
    AiModule,
    LibraryModule,
    ExportModule,
    LogModule,
    ReminderModule,
  ],
  providers: [
    // 全局守卫（按声明顺序执行）：登录 → 权益门控 → 管理员
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AdminGuard },
    // 统一响应 / 异常
    { provide: APP_INTERCEPTOR, useExisting: ResponseInterceptor },
    { provide: APP_FILTER, useExisting: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PlatformMiddleware).forRoutes('*');
  }
}