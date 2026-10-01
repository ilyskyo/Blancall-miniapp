import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { parseZod } from '../common/zod.util';
import type { AuthUser } from '../common/types';
import {
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  syncPushSchema,
  type SyncPushBody,
} from './sync.dto';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** POST /sync/push —— 实体级 LWW 上传 */
  @Post('push')
  async push(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto: SyncPushBody = parseZod(syncPushSchema, body);
    return this.sync.push(user.id, dto);
  }

  /** GET /sync/pull?cursor=&limit= —— 增量拉取（含墓碑） */
  @Get('pull')
  async pull(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedCursor = Number.parseInt(String(cursor ?? '0'), 10);
    const cursorNum = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;

    const parsedLimit = Number.parseInt(String(limit ?? ''), 10);
    const limitNum =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, PULL_MAX_LIMIT)
        : PULL_DEFAULT_LIMIT;

    return this.sync.pull(user.id, cursorNum, limitNum);
  }
}