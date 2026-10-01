import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CN_OFFSET_MS, cnDateFromString, cnDateString } from '../common/time.util';
import { PrismaService } from '../prisma/prisma.service';
import { WechatSubscribeService } from '../wechat/wechat-subscribe.service';

export type ReminderFrequency = 'DAILY' | 'WEEKLY_FIVE' | 'WEEKLY_THREE' | 'OFF';

interface ReminderSettings {
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  reminderFrequency: ReminderFrequency;
  reminderGoalMinutes: number;
}

interface ReminderCopy {
  /** 模板 thing 字段文案（微信限制 ≤20 字） */
  text: string;
  /** 模板 number 字段数值 */
  number: number;
  /** 命中的文案优先级，仅用于日志 */
  kind: 'unfinished' | 'weak' | 'streak' | 'not_started';
}

const MSG_PAGE = 'pages/home/home';
/** thing 类型字段最大长度 */
const THING_MAX_LEN = 20;

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(s: string): string {
  return s.length > THING_MAX_LEN ? s.slice(0, THING_MAX_LEN) : s;
}

/**
 * 学习提醒调度（服务端发订阅消息）
 *
 * 数据源：`entities` 表中 `entity = 'app_settings'` 的 payload（客户端写入：
 * reminderEnabled / reminderHour / reminderMinute / reminderFrequency / reminderGoalMinutes）
 *
 * 小程序无常驻后台，因此提醒完全由服务端定时任务发送。
 * 幂等：`reminder_sent_logs` 的 (user_id, date) 唯一约束保证同一自然日只发一次。
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly subscribe: WechatSubscribeService,
  ) {}

  /**
   * 每小时整点扫描（Asia/Shanghai）
   * 说明：扫描粒度为小时，命中判定按「当日分钟窗口」[reminderHour*60+reminderMinute, +59]，
   *       因此实际发送时刻为配置时刻之后的第一个整点（最多晚 59 分钟，每天恰好命中一次）。
   *       若需分钟级精度，可把表达式改为「每 5 分钟执行一次」的 cron 写法。
   */
  @Cron('0 * * * *', { timeZone: 'Asia/Shanghai' })
  async handleHourly(): Promise<void> {
    await this.scanAndSend().catch((e) => {
      this.logger.error(`学习提醒扫描失败：${(e as Error).message}`);
    });
  }

  /** 执行一次扫描（可注入 now 便于测试） */
  async scanAndSend(now: Date = new Date()): Promise<{ scanned: number; sent: number; skipped: number }> {
    const templateId = this.cfg.wxSubscribe.templateId;
    if (!templateId) {
      this.logger.warn('未配置 WX_SUBSCRIBE_TEMPLATE_ID，学习提醒已跳过（不影响其他功能）');
      return { scanned: 0, sent: 0, skipped: 0 };
    }
    if (!this.subscribe.configured) {
      this.logger.warn('未配置 WX_APPID / WX_SECRET，学习提醒已跳过');
      return { scanned: 0, sent: 0, skipped: 0 };
    }

    const cnNow = new Date(now.getTime() + CN_OFFSET_MS);
    const hour = cnNow.getUTCHours();
    const minute = cnNow.getUTCMinutes();
    const dateStr = cnDateString(now);
    const weekday = this.weekdayOf(dateStr);

    const rows = await this.prisma.entity.findMany({
      where: { entity: 'app_settings', deleted: false },
      select: { userId: true, payload: true },
    });

    let sent = 0;
    let skipped = 0;

    for (const row of rows) {
      const settings = this.parseSettings(row.payload);
      if (!settings.reminderEnabled) {
        skipped += 1;
        continue;
      }
      if (!this.isReminderDay(settings.reminderFrequency, weekday)) {
        skipped += 1;
        continue;
      }
      if (!this.withinWindow(hour, minute, settings.reminderHour, settings.reminderMinute)) {
        skipped += 1;
        continue;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { id: true, openid: true, streakCurrent: true },
      });
      if (!user) {
        skipped += 1;
        continue;
      }

      // 幂等占位：同一用户同一自然日只能插入一次
      const date = cnDateFromString(dateStr);
      try {
        await this.prisma.reminderSentLog.create({
          data: { userId: user.id, date, templateId, result: 'pending' },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          skipped += 1; // 今天已发送过
          continue;
        }
        throw e;
      }

      const copy = await this.buildCopy(user.id, user.streakCurrent, settings.reminderGoalMinutes);

      // ⚠️ 以下 data 键名（thing1/number2/date3/thing4）为占位示例，
      //    必须与在微信公众平台「订阅消息」里申请到的模板字段一一对应；
      //    申请后请按实际字段名/类型调整（thing=短语≤20字，number=数字，date=日期，time=时间）。
      const result = await this.subscribe.sendSubscribeMessage({
        openid: user.openid,
        templateId,
        page: MSG_PAGE,
        data: {
          thing1: { value: copy.text },
          number2: { value: copy.number },
          date3: { value: dateStr },
          thing4: { value: 'Blancall 背诵助手' },
        },
      });

      await this.prisma.reminderSentLog
        .update({
          where: { userId_date: { userId: user.id, date } },
          data: {
            result: result.ok
              ? `ok:${result.msgid ?? ''}`
              : `fail:${result.errcode ?? ''}:${result.errmsg ?? ''}`,
          },
        })
        .catch(() => undefined);

      if (result.ok) {
        sent += 1;
        this.logger.log(`学习提醒已发送 userId=${user.id} kind=${copy.kind}`);
      } else {
        skipped += 1;
      }
    }

    this.logger.log(`学习提醒扫描完成：候选 ${rows.length}，发送 ${sent}，跳过 ${skipped}`);
    return { scanned: rows.length, sent, skipped };
  }

  // ------------------------------------------------------------ 内部

  private parseSettings(payload: unknown): ReminderSettings {
    const p = (payload ?? {}) as Record<string, unknown>;
    const freqRaw = String(p.reminderFrequency ?? 'OFF').toUpperCase();
    const frequency: ReminderFrequency =
      freqRaw === 'DAILY' || freqRaw === 'WEEKLY_FIVE' || freqRaw === 'WEEKLY_THREE'
        ? (freqRaw as ReminderFrequency)
        : 'OFF';

    return {
      reminderEnabled: p.reminderEnabled === true,
      reminderHour: Math.min(Math.max(toInt(p.reminderHour, 20), 0), 23),
      reminderMinute: Math.min(Math.max(toInt(p.reminderMinute, 0), 0), 59),
      reminderFrequency: frequency,
      reminderGoalMinutes: Math.max(toInt(p.reminderGoalMinutes, 0), 0),
    };
  }

  /** 中国自然日对应星期（1=周一 .. 7=周日） */
  private weekdayOf(dateStr: string): number {
    const day = cnDateFromString(dateStr).getUTCDay(); // 0=周日
    return day === 0 ? 7 : day;
  }

  /** 今天是否为应提醒日 */
  private isReminderDay(frequency: ReminderFrequency, weekday: number): boolean {
    switch (frequency) {
      case 'DAILY':
        return true;
      case 'WEEKLY_FIVE':
        return weekday <= 5; // 周一至周五
      case 'WEEKLY_THREE':
        return weekday === 1 || weekday === 3 || weekday === 5; // 周一/三/五
      default:
        return false;
    }
  }

  /** 是否落在当日分钟窗口 [target, target+59] */
  private withinWindow(hour: number, minute: number, targetHour: number, targetMinute: number): boolean {
    const target = targetHour * 60 + targetMinute;
    const windowEnd = target + 59;
    const nowMin = hour * 60 + minute;

    if (nowMin >= target && nowMin <= windowEnd) return true;
    // 窗口跨过午夜（例如 23:50 的目标时刻）
    if (windowEnd > 24 * 60) {
      const wrapped = nowMin + 24 * 60;
      return wrapped >= target && wrapped <= windowEnd;
    }
    return false;
  }

  /**
   * 文案优先级：未完成练习 > 薄弱内容 > 连续学习 > 今日未学
   * （未完成/薄弱数据从云同步实体中粗略统计，不做全量精确计算）
   */
  private async buildCopy(userId: string, streak: number, goalMinutes: number): Promise<ReminderCopy> {
    // 1) 未完成的练习进度（practice_state.status === 'IN_PROGRESS'）
    let unfinished = 0;
    try {
      unfinished = await this.prisma.entity.count({
        where: {
          userId,
          entity: 'practice_state',
          deleted: false,
          payload: { path: ['status'], equals: 'IN_PROGRESS' },
        },
      });
    } catch (e) {
      this.logger.warn(`统计未完成练习失败（忽略）：${(e as Error).message}`);
    }
    if (unfinished > 0) {
      return {
        text: clamp(`你有 ${unfinished} 篇练习未完成，接着练吧`),
        number: unfinished,
        kind: 'unfinished',
      };
    }

    // 2) 薄弱内容：最近练习记录中存在错题
    const records = await this.prisma.entity.findMany({
      where: { userId, entity: 'practice_record', deleted: false },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { payload: true },
    });
    const hasWeak = records.some((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      return Array.isArray(p.mistakes) && p.mistakes.length > 0;
    });
    if (hasWeak) {
      return { text: clamp('有薄弱内容待复习，来巩固一下'), number: 0, kind: 'weak' };
    }

    // 3) 连续学习
    if (streak > 0) {
      return { text: clamp(`已连续学习 ${streak} 天，今天继续`), number: streak, kind: 'streak' };
    }

    // 4) 今日未学
    return {
      text: clamp(goalMinutes > 0 ? `今天还没练习，目标 ${goalMinutes} 分钟` : '今天还没练习，来背一段吧'),
      number: goalMinutes,
      kind: 'not_started',
    };
  }
}