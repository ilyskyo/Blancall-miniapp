import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { cnDateString } from '../common/time.util';

/**
 * 平台级 AI 日预算熔断
 * - 上限来源：env `AI_DAILY_BUDGET_CARDS`（每日全平台最多消耗的 AI 卡数）；0 或未配置 = 不限制
 * - 计数表：`ai_daily_usage`（date=YYYY-MM-DD 主键 + cards_used）
 * - 并发安全：`upsert` 命中主键行锁 + `increment` 原子自增，事务内读取自增后的值再判断
 * - 与扣卡同事务：超预算抛 AI_BUDGET_EXCEEDED，事务回滚，扣卡与用量一并撤销
 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** 预算上限（卡数）；0 表示不限制 */
  get budget(): number {
    return this.cfg.ai.dailyBudgetCards;
  }

  get enabled(): boolean {
    return this.budget > 0;
  }

  /**
   * 校验并累加今日用量（须在扣卡的同一事务内调用）
   * 超预算时抛 AI_BUDGET_EXCEEDED。
   */
  async assertAndConsume(tx: Prisma.TransactionClient, cost: number, at: Date = new Date()): Promise<void> {
    if (cost <= 0 || !this.enabled) return;
    const date = cnDateString(at);
    const row = await tx.aiDailyUsage.upsert({
      where: { date },
      create: { date, cardsUsed: cost },
      update: { cardsUsed: { increment: cost } },
    });
    if (row.cardsUsed > this.budget) {
      this.logger.warn(`AI 日预算熔断：budget=${this.budget} used=${row.cardsUsed} cost=${cost}`);
      throw AppError.aiBudgetExceeded(this.budget, row.cardsUsed);
    }
  }

  /** 归还今日用量（上游失败返还 AI 卡时同步释放，避免预算被无效消耗） */
  async release(tx: Prisma.TransactionClient, cost: number, at: Date = new Date()): Promise<void> {
    if (cost <= 0 || !this.enabled) return;
    await tx.aiDailyUsage.updateMany({
      where: { date: cnDateString(at), cardsUsed: { gte: cost } },
      data: { cardsUsed: { decrement: cost } },
    });
  }
}
