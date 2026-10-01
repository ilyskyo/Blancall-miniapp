import { Module } from '@nestjs/common';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardSnapshotService } from './leaderboard.snapshot.service';

@Module({
  controllers: [LeaderboardController],
  providers: [LeaderboardService, LeaderboardSnapshotService],
  exports: [LeaderboardService, LeaderboardSnapshotService],
})
export class LeaderboardModule {}