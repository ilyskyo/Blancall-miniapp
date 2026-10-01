import { Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { CheckinService } from './checkin.service';

@Controller('checkin')
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  /** POST /checkin */
  @Post()
  async doCheckin(@CurrentUser() user: AuthUser) {
    return this.checkin.checkin(user.id);
  }

  /** GET /checkin/calendar?month=YYYY-MM */
  @Get('calendar')
  async calendar(@CurrentUser() user: AuthUser, @Query('month') month?: string) {
    return this.checkin.calendar(user.id, month);
  }
}