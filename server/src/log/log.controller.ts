import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { parseZod } from '../common/zod.util';
import { errorSchema, eventsSchema, type ErrorBody, type EventsBody } from './log.dto';
import { LogService } from './log.service';

/** 日志接口对游客开放（未登录也能上报错误）；携带 token 时记录 userId */
@Controller('log')
export class LogController {
  constructor(private readonly log: LogService) {}

  /** POST /log/events —— 批量埋点 */
  @Public()
  @Post('events')
  async events(@CurrentUser() user: AuthUser | undefined, @Body() body: unknown) {
    const dto: EventsBody = parseZod(eventsSchema, body);
    return this.log.events(user?.id ?? null, dto);
  }

  /** POST /log/error —— 前端错误上报 */
  @Public()
  @Post('error')
  async error(@CurrentUser() user: AuthUser | undefined, @Body() body: unknown) {
    const dto: ErrorBody = parseZod(errorSchema, body);
    return this.log.error(user?.id ?? null, dto);
  }
}