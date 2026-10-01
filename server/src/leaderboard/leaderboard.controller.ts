import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/types';
import { LeaderboardService, type LeaderboardPeriod, type LeaderboardType } from './leaderboard.service';

const TYPES: readonly string[] = ['credit', 'time'];
const PERIODS: readonly string[] = ['week', 'all'];

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /** GET /leaderboard?type=credit|time&period=week|all */
  @Get()
  async get(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('period') period?: string,
  ) {
    const t = type ?? 'credit';
    const p = period ?? 'all';
    if (!TYPES.includes(t)) throw AppError.invalidArgument('type 仅支持 credit | time');
    if (!PERIODS.includes(p)) throw AppError.invalidArgument('period 仅支持 week | all');
    return this.leaderboard.get(user.id, t as LeaderboardType, p as LeaderboardPeriod);
  }
}