import { Injectable } from '@nestjs/common';
import { cnDateFromString, cnDateString, cnWeekStartStr } from '../common/time.util';
import { PrismaService } from '../prisma/prisma.service';

export type LeaderboardType = 'credit' | 'time';
export type LeaderboardPeriod = 'week' | 'all';

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  isMe: boolean;
}

export interface LeaderboardResult {
  top: LeaderboardEntry[];
  me: { rank: number; score: number };
}

/** 榜单展示条数 */
const TOP_N = 100;

/** 昵称脱敏：保留前 2 字 + ****（如「用户****」） */
export function maskNickname(nickname: string | null | undefined): string {
  const n = (nickname ?? '').trim();
  if (n === '') return '用户****';
  const head = n.length >= 2 ? n.slice(0, 2) : n;
  return `${head}****`;
}

/**
 * 排行榜
 * - credit：users.credits 排行
 * - time：study_stats 聚合（practice_seconds + reading_seconds）
 * - rank_visible=false 的用户不出现在榜单，但仍返回其个人排名
 * - 昵称统一脱敏（A-6）
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, type: LeaderboardType, period: LeaderboardPeriod): Promise<LeaderboardResult> {
    const board = await this.computeBoard(type, period, userId);
    return { top: board.top, me: board.me ?? { rank: 0, score: 0 } };
  }

  /** 供每日快照使用（不带 isMe 视角） */
  computeBoard(
    type: LeaderboardType,
    period: LeaderboardPeriod,
    viewerId?: string,
  ): Promise<{ top: LeaderboardEntry[]; me: { rank: number; score: number } | null }> {
    return type === 'credit' ? this.creditBoard(viewerId) : this.timeBoard(period, viewerId);
  }

  private async creditBoard(
    viewerId?: string,
  ): Promise<{ top: LeaderboardEntry[]; me: { rank: number; score: number } | null }> {
    const [rows, me] = await Promise.all([
      this.prisma.user.findMany({
        where: { rankVisible: true },
        orderBy: [{ credits: 'desc' }, { createdAt: 'asc' }],
        take: TOP_N,
        select: { id: true, nickname: true, credits: true },
      }),
      viewerId
        ? this.prisma.user.findUnique({ where: { id: viewerId }, select: { credits: true } })
        : Promise.resolve(null),
    ]);

    const myScore = me?.credits ?? 0;
    const above = viewerId
      ? await this.prisma.user.count({ where: { credits: { gt: myScore } } })
      : 0;

    return {
      top: rows.map((u, i) => ({
        rank: i + 1,
        nickname: maskNickname(u.nickname),
        score: u.credits,
        isMe: u.id === viewerId,
      })),
      me: viewerId ? { rank: above + 1, score: myScore } : null,
    };
  }

  private async timeBoard(
    period: LeaderboardPeriod,
    viewerId?: string,
  ): Promise<{ top: LeaderboardEntry[]; me: { rank: number; score: number } | null }> {
    const where =
      period === 'week'
        ? { date: { gte: cnDateFromString(cnWeekStartStr(cnDateString())) } }
        : {};

    const stats = await this.prisma.studyStat.findMany({
      where,
      select: { userId: true, practiceSeconds: true, readingSeconds: true },
    });

    const totals = new Map<string, number>();
    for (const s of stats) {
      totals.set(s.userId, (totals.get(s.userId) ?? 0) + s.practiceSeconds + s.readingSeconds);
    }

    const ids = Array.from(totals.keys());
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, nickname: true, rankVisible: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const entries = ids
      .map((id) => ({
        id,
        score: totals.get(id) ?? 0,
        nickname: userMap.get(id)?.nickname ?? null,
        visible: userMap.get(id)?.rankVisible ?? false,
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const top = entries
      .filter((e) => e.visible)
      .slice(0, TOP_N)
      .map((e, i) => ({
        rank: i + 1,
        nickname: maskNickname(e.nickname),
        score: e.score,
        isMe: e.id === viewerId,
      }));

    if (!viewerId) return { top, me: null };

    const myScore = totals.get(viewerId) ?? 0;
    const rank = entries.filter((e) => e.score > myScore).length + 1;
    return { top, me: { rank, score: myScore } };
  }
}