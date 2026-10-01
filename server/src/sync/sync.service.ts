import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cnDateFromString, parseUpdatedAt } from '../common/time.util';
import { PrismaService } from '../prisma/prisma.service';
import type { SyncOp, SyncPushBody } from './sync.dto';

export interface PushResultItem {
  entity: string;
  uuid: string;
  status: 'applied' | 'conflict';
  rev: number;
  serverUpdatedAt: number;
}

export interface PullResult {
  items: Array<{
    entity: string;
    uuid: string;
    op: string;
    payload: unknown;
    rev: number;
    updatedAt: number;
  }>;
  nextCursor: number;
  hasMore: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 核心学习数据同步
 * - 冲突策略：实体级 LWW（比较 updatedAt，服务端 rev 全局单调递增）
 * - rev 由 PostgreSQL 序列 entity_rev_seq 生成（全局单调，跨用户唯一）
 * - 删除写墓碑（op=delete, deleted=true）
 * - study_stat 实体额外落 study_stats 表，供排行榜聚合
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /** 取全局单调递增序号 */
  private async nextRev(tx: Prisma.TransactionClient): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ rev: bigint }>>(
      Prisma.sql`SELECT nextval('entity_rev_seq') AS rev`,
    );
    return rows[0]?.rev ?? 0n;
  }

  /** 解析 op 的更新时间：op.updatedAt 优先，其次 payload.updatedAt，最后当前时间 */
  private resolveUpdatedAt(op: SyncOp): Date {
    const direct = parseUpdatedAt(op.updatedAt);
    if (direct) return direct;
    if (op.payload && typeof op.payload === 'object') {
      const fromPayload = parseUpdatedAt((op.payload as Record<string, unknown>).updatedAt);
      if (fromPayload) return fromPayload;
    }
    return new Date();
  }

  async push(userId: string, body: SyncPushBody): Promise<{ results: PushResultItem[]; serverTime: number }> {
    const results: PushResultItem[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const op of body.ops) {
        const incomingAt = this.resolveUpdatedAt(op);
        const where = { userId_entity_uuid: { userId, entity: op.entity, uuid: op.uuid } };
        const existing = await tx.entity.findUnique({ where });

        // LWW：服务端不早于客户端 → 冲突，返回服务端版本
        if (existing && existing.updatedAt.getTime() >= incomingAt.getTime()) {
          results.push({
            entity: op.entity,
            uuid: op.uuid,
            status: 'conflict',
            rev: Number(existing.rev),
            serverUpdatedAt: existing.updatedAt.getTime(),
          });
          continue;
        }

        const rev = await this.nextRev(tx);
        const payload = (
          op.payload !== undefined ? op.payload : (existing?.payload ?? {})
        ) as Prisma.InputJsonValue;

        if (op.op === 'delete') {
          // 墓碑
          await tx.entity.upsert({
            where,
            create: {
              userId,
              entity: op.entity,
              uuid: op.uuid,
              op: 'delete',
              payload,
              rev,
              updatedAt: incomingAt,
              deleted: true,
            },
            update: { op: 'delete', payload, rev, updatedAt: incomingAt, deleted: true },
          });
        } else {
          await tx.entity.upsert({
            where,
            create: {
              userId,
              entity: op.entity,
              uuid: op.uuid,
              op: 'upsert',
              payload,
              rev,
              updatedAt: incomingAt,
              deleted: false,
            },
            update: { op: 'upsert', payload, rev, updatedAt: incomingAt, deleted: false },
          });
          if (op.entity === 'study_stat') {
            await this.upsertStudyStat(tx, userId, payload);
          }
        }

        results.push({
          entity: op.entity,
          uuid: op.uuid,
          status: 'applied',
          rev: Number(rev),
          serverUpdatedAt: incomingAt.getTime(),
        });
      }

      // 记录用户已同步游标（entities.rev 最大值）
      const appliedRevs = results.filter((r) => r.status === 'applied').map((r) => r.rev);
      if (appliedRevs.length > 0) {
        const maxRev = BigInt(Math.max(...appliedRevs));
        await tx.syncCursor.upsert({
          where: { userId },
          create: { userId, cursor: maxRev },
          update: { cursor: maxRev },
        });
      }
    });

    return { results, serverTime: Date.now() };
  }

  /** study_stat 实体 → study_stats 表（排行榜数据源） */
  private async upsertStudyStat(
    tx: Prisma.TransactionClient,
    userId: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const p = payload as Record<string, unknown>;
    const dateStr = typeof p.date === 'string' ? p.date : '';
    if (!DATE_RE.test(dateStr)) return;

    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    };
    const practiceSeconds = num(p.practiceSeconds);
    const readingSeconds = num(p.readingSeconds);
    const practiceCount = num(p.practiceCount);
    const date = cnDateFromString(dateStr);

    await tx.studyStat.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, practiceSeconds, readingSeconds, practiceCount },
      update: { practiceSeconds, readingSeconds, practiceCount },
    });
  }

  /** 增量拉取：rev > cursor 升序（含墓碑） */
  async pull(userId: string, cursor: number, limit: number): Promise<PullResult> {
    const rows = await this.prisma.entity.findMany({
      where: { userId, rev: { gt: BigInt(cursor) } },
      orderBy: { rev: 'asc' },
      take: limit,
    });

    const items = rows.map((r) => ({
      entity: r.entity,
      uuid: r.uuid,
      op: r.op,
      payload: r.payload,
      rev: Number(r.rev),
      updatedAt: r.updatedAt.getTime(),
    }));

    const last = rows.length > 0 ? rows[rows.length - 1] : null;
    const nextCursor = last ? Number(last.rev) : cursor;

    let hasMore = false;
    if (rows.length === limit) {
      const remaining = await this.prisma.entity.count({
        where: { userId, rev: { gt: BigInt(nextCursor) } },
      });
      hasMore = remaining > 0;
    }

    if (rows.length > 0) {
      const current = await this.prisma.syncCursor.findUnique({ where: { userId } });
      const merged = Math.max(Number(current?.cursor ?? 0n), nextCursor);
      await this.prisma.syncCursor.upsert({
        where: { userId },
        create: { userId, cursor: BigInt(merged) },
        update: { cursor: BigInt(merged) },
      });
    }

    return { items, nextCursor, hasMore };
  }
}