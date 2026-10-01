import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ErrorBody, EventsBody } from './log.dto';

/** 去掉 undefined，避免 Prisma JSON 字段写入报错 */
function cleanJson(obj: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Prisma.InputJsonValue;
}

/** 埋点 props 上限（公开接口，防止匿名刷量把 audit_log 撑爆） */
const MAX_PROPS_CHARS = 2000;

/** props 体积超限或不可序列化时只留标记，避免写入超大 JSON */
function sanitizeProps(props: unknown): unknown {
  if (props === undefined || props === null) return null;
  try {
    const text = JSON.stringify(props);
    if (typeof text === 'string' && text.length <= MAX_PROPS_CHARS) return props;
  } catch {
    /* 循环引用等情况 */
  }
  return { _truncated: true };
}

/** 埋点与前端错误上报（匿名亦可，登录时记录 userId） */
@Injectable()
export class LogService {
  constructor(private readonly prisma: PrismaService) {}

  async events(userId: string | null, body: EventsBody): Promise<{ accepted: number }> {
    const now = Date.now();
    await this.prisma.auditLog.createMany({
      data: body.events.map((e) => ({
        userId,
        action: 'event',
        detail: cleanJson({ name: e.name, ts: e.ts ?? now, props: sanitizeProps(e.props) }),
      })),
    });
    return { accepted: body.events.length };
  }

  async error(userId: string | null, body: ErrorBody): Promise<{ accepted: boolean }> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'error',
        detail: cleanJson({
          message: body.message,
          stack: body.stack,
          page: body.page,
          ua: body.ua,
          ts: body.ts ?? Date.now(),
        }),
      },
    });
    return { accepted: true };
  }
}