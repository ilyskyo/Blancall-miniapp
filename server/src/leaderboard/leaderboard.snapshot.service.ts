import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { cnDateString, cnWeekStartStr } from '../common/time.util';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService, type LeaderboardPeriod, type LeaderboardType } from './leaderboard.service';

/** 每日定时生成排行榜快照（默认 03:00，Asia/Shanghai，可由 LEADERBOARD_CRON 覆盖） */
@Injectable()
export class LeaderboardSnapshotService implements OnModuleInit {
  private readonly logger = new Logger(LeaderboardSnapshotService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const job = new CronJob(
      this.cfg.leaderboardCron,
      () => {
        void this.generateAll().catch((e) => {
          this.logger.error(`排行榜快照生成失败：${(e as Error).message}`);
        });
      },
      null,
      true,
      this.cfg.timezone,
    );
    this.scheduler.addCronJob(
      'leaderboard-snapshots',
      // 说明：@nestjs/schedule 自带一份 cron，实例类型与顶层 'cron' 不同（私有属性不兼容），
      // 运行时 API 兼容（同为 cron 3.x），这里显式断言为 SchedulerRegistry 期望的类型。
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    this.logger.log(
      `排行榜快照任务已注册：${this.cfg.leaderboardCron}（时区 ${this.cfg.timezone}）`,
    );
  }

  /** 生成 credit/time × week/all 四组快照 */
  async generateAll(): Promise<number> {
    const combos: Array<{ type: LeaderboardType; period: LeaderboardPeriod }> = [
      { type: 'credit', period: 'all' },
      { type: 'credit', period: 'week' },
      { type: 'time', period: 'all' },
      { type: 'time', period: 'week' },
    ];
    const weekKey = cnWeekStartStr(cnDateString());
    let count = 0;

    for (const { type, period } of combos) {
      const board = await this.leaderboard.computeBoard(type, period);
      const periodKey = period === 'week' ? weekKey : 'all';
      const payload = {
        type,
        period,
        periodKey,
        top: board.top,
        generatedAt: Date.now(),
      } as unknown as Prisma.InputJsonValue;

      await this.prisma.leaderboardSnapshot.upsert({
        where: { type_period_periodKey: { type, period, periodKey } },
        create: { type, period, periodKey, payload },
        update: { payload, generatedAt: new Date() },
      });
      count += 1;
    }

    this.logger.log(`排行榜快照生成完成，共 ${count} 组`);
    return count;
  }
}