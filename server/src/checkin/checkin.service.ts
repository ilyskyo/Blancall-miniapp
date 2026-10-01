import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import {
  cnDateFromString,
  cnDateString,
  cnYesterdayStr,
  currentMonth,
  dateToCnString,
  monthDays,
} from '../common/time.util';
import { PrismaService } from '../prisma/prisma.service';

export interface CheckinResult {
  credits: number;
  streak: { current: number; longest: number };
  alreadyCheckedIn?: boolean;
}

export interface CheckinCalendar {
  month: string;
  days: Array<{ date: string; checkedIn: boolean }>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * 签到与连续激励（免费版）
 * - Asia/Shanghai 自然日 + (user_id, date) 唯一约束防重复
 * - streak：昨天签到过则 +1，否则归 1
 * - credits：纯免费激励积分（与付费无关）
 */
@Injectable()
export class CheckinService {
  constructor(private readonly prisma: PrismaService) {}

  async checkin(userId: string): Promise<CheckinResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('用户不存在');

    const todayStr = cnDateString();
    const today = cnDateFromString(todayStr);

    const existing = await this.prisma.checkin.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (existing) {
      return {
        credits: 0,
        streak: { current: user.streakCurrent, longest: user.streakLongest },
        alreadyCheckedIn: true,
      };
    }

    const lastStr = user.lastCheckinDate ? dateToCnString(user.lastCheckinDate) : null;
    const streak = lastStr === cnYesterdayStr() ? user.streakCurrent + 1 : 1;
    const longest = Math.max(user.streakLongest, streak);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.checkin.create({
          data: { userId, date: today, creditsDelta: 1, streakAfter: streak },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            credits: { increment: 1 },
            streakCurrent: streak,
            streakLongest: longest,
            lastCheckinDate: today,
          },
        });
        await tx.creditLedger.create({ data: { userId, delta: 1, reason: 'checkin' } });
      });
    } catch (e) {
      // 并发重复签到：唯一约束冲突 → 幂等返回
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const fresh = await this.prisma.user.findUnique({ where: { id: userId } });
        return {
          credits: 0,
          streak: { current: fresh?.streakCurrent ?? streak, longest: fresh?.streakLongest ?? longest },
          alreadyCheckedIn: true,
        };
      }
      throw e;
    }

    return { credits: 1, streak: { current: streak, longest } };
  }

  async calendar(userId: string, month?: string): Promise<CheckinCalendar> {
    const target = month && MONTH_RE.test(month) ? month : currentMonth();
    const dates = monthDays(target);
    if (dates.length === 0) throw AppError.invalidArgument('月份格式应为 YYYY-MM');

    const rows = await this.prisma.checkin.findMany({
      where: {
        userId,
        date: {
          gte: cnDateFromString(dates[0]),
          lte: cnDateFromString(dates[dates.length - 1]),
        },
      },
    });
    const checked = new Set(rows.map((r) => dateToCnString(r.date)));

    return {
      month: target,
      days: dates.map((d) => ({ date: d, checkedIn: checked.has(d) })),
    };
  }
}
