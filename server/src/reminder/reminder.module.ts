import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';

/**
 * 学习提醒（服务端订阅消息发送）
 * 无 HTTP 接口：设置项由客户端写入 app_settings 实体，服务端每小时扫描后发送。
 */
@Module({
  providers: [ReminderService],
  exports: [ReminderService],
})
export class ReminderModule {}