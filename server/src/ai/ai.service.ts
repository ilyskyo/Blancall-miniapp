import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, isAiConfigured, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { httpFetch } from '../common/http';
import { AI_COST_RULE, clozeCost } from '../common/features';
import { PrismaService } from '../prisma/prisma.service';
import { WechatSecurityService } from '../wechat/wechat-security.service';
import { AiBudgetService } from './ai-budget.service';
import type { AnalysisBody, ChatBody, ClozeBody } from './ai.dto';
import {
  HISTORY_BUDGET_CHARS,
  MAX_INPUT_CHARS,
  buildAnalysisMessages,
  buildChatSystem,
  buildClozeMessages,
  parseCoords,
  type ClozeCoords,
} from './ai.prompt';

interface UpstreamMessage {
  role: string;
  content: string;
}

/**
 * AI 平台代理
 * - 门控（D12）：会员 / 体验卡 / 持有 AI 挖空卡 任一即可；余额不足由扣卡环节拒绝
 * - 计费（A-1）：挖空 ceil(字符数/500)、训练分析 1 张、对话 1 张/条
 * - 输入输出均送内容安全检测；响应含 aiGenerated: true；不含联网搜索
 * - 对话为分块响应（Transfer-Encoding: chunked，转发上游 SSE 内容增量）
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly security: WechatSecurityService,
  ) {}

  // ------------------------------------------------------------ 挖空

  async cloze(userId: string, openid: string, dto: ClozeBody) {
    const text = dto.articleText.slice(0, MAX_INPUT_CHARS);
    const cost = clozeCost(text.length);

    // 输入送检
    const security = await this.security.assertText(text.slice(0, 2500), openid);

    const raw = await this.withCharge(userId, cost, 'cloze', () =>
      this.callCompletion(
        buildClozeMessages({
          text,
          mode: dto.mode,
          strategy: dto.strategy,
          level: dto.level,
          extra: dto.extra,
        }),
      ),
    );

    const coords: ClozeCoords = parseCoords(raw);
    // 输出送检
    await this.security.assertText(JSON.stringify(coords).slice(0, 2500), openid);

    return { coords, aiGenerated: true as const, cost, securitySkipped: security.skipped };
  }

  // ------------------------------------------------------------ 训练分析

  async analysis(userId: string, openid: string, dto: AnalysisBody) {
    const cost = AI_COST_RULE.analysis;

    const inputSummary = JSON.stringify({
      title: dto.title,
      mode: dto.mode,
      accuracy: dto.accuracy,
    }).slice(0, 2500);
    const security = await this.security.assertText(inputSummary, openid);

    const markdown = await this.withCharge(userId, cost, 'analysis', () =>
      this.callCompletion(buildAnalysisMessages(dto)),
    );

    await this.security.assertText(markdown.slice(0, 2500), openid);

    return { markdown, aiGenerated: true as const, cost, securitySkipped: security.skipped };
  }

  // ------------------------------------------------------------ 对话（分块响应）

  async chat(userId: string, openid: string, dto: ChatBody, res: Response): Promise<void> {
    this.assertAiConfigured();

    const userMessages = dto.messages.filter((m) => m.role === 'user');
    const cost = Math.max(1, userMessages.length);

    // 输入送检
    for (const m of userMessages) {
      await this.security.assertText(m.content.slice(0, 2500), openid);
    }

    // 会话
    const session = dto.sessionId
      ? await this.findSession(userId, dto.sessionId)
      : await this.prisma.aiSession.create({
          data: {
            userId,
            title: (userMessages[0]?.content ?? '新会话').slice(0, 20),
          },
        });

    // 用量记账（日预算熔断，同一事务）
    await this.prisma.$transaction(async (tx) => {
      await this.budget.assertAndConsume(tx, cost);
    });

    // 落库本次提交的消息
    for (const m of dto.messages) {
      await this.prisma.aiMessage.create({
        data: { sessionId: session.id, role: m.role, content: m.content },
      });
    }

    // 文章上下文
    const articles = dto.articleUuids?.length ? await this.loadArticles(userId, dto.articleUuids) : [];
    const upstreamMessages: UpstreamMessage[] = [
      { role: 'system', content: buildChatSystem(articles) },
      ...this.trimHistory(dto.messages),
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.ai.timeoutMs);

    let upstream: any;
    try {
      upstream = await this.openStream(upstreamMessages, controller.signal);
    } catch (e) {
      clearTimeout(timer);
      await this.releaseBudget(cost);
      throw e;
    }

    // 分块响应头（未设置 Content-Length → Node 使用 Transfer-Encoding: chunked）
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let full = '';
    try {
      full = await this.pipeStream(upstream, res, session.id);
    } catch (e) {
      this.logger.warn(`对话流中断：${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    res.write(`data: ${JSON.stringify({ sessionId: session.id, done: true, aiGenerated: true })}\n\n`);
    res.end();

    // 落库助手消息 + 输出送检（失败仅告警，不影响已完成的响应）
    try {
      await this.prisma.aiMessage.create({
        data: { sessionId: session.id, role: 'assistant', content: full },
      });
      await this.prisma.aiSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
      await this.security.checkText(full.slice(0, 2500), openid);
    } catch (e) {
      this.logger.warn(`对话结果落库/送检失败：${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------ 会话

  async listSessions(userId: string) {
    const rows = await this.prisma.aiSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { _count: { select: { messages: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      messageCount: r._count.messages,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    }));
  }

  async getSession(userId: string, id: string) {
    const session = await this.prisma.aiSession.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw AppError.notFound('会话不存在');
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.getTime(),
      })),
    };
  }

  async deleteSession(userId: string, id: string): Promise<{ deleted: true }> {
    await this.findSession(userId, id);
    await this.prisma.aiSession.delete({ where: { id } });
    return { deleted: true };
  }

  // ------------------------------------------------------------ 内部

  private assertAiConfigured(): void {
    if (!isAiConfigured(this.cfg)) {
      throw AppError.upstreamFailed('AI 上游未配置：请设置 AI_BASE_URL / AI_API_KEY / AI_MODEL');
    }
  }

  private async findSession(userId: string, id: string) {
    const session = await this.prisma.aiSession.findFirst({ where: { id, userId } });
    if (!session) throw AppError.notFound('会话不存在');
    return session;
  }

  /**
   * 扣费执行（日预算校验 + 扣卡，同一事务）；上游失败自动返还
   * 限时免费活动覆盖 AI 时：只做平台日预算熔断，**不扣卡**（返还也相应只释放预算，避免凭空发卡）
   */
  private async withCharge<T>(userId: string, cost: number, ref: string, fn: () => Promise<T>): Promise<T> {
    await this.prisma.$transaction(async (tx) => {
      await this.budget.assertAndConsume(tx, cost);
    });
    try {
      return await fn();
    } catch (e) {
      await this.releaseBudget(cost);
      throw e;
    }
  }

  /** 上游失败时释放日预算（完全免费，无卡可返还） */
  private async releaseBudget(cost: number): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.budget.release(tx, cost);
      });
    } catch (e) {
      this.logger.warn(`AI 预算释放失败 cost=${cost}: ${(e as Error).message}`);
    }
  }

  /** 非流式 chat/completions 调用 */
  private async callCompletion(messages: UpstreamMessage[]): Promise<string> {
    this.assertAiConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.ai.timeoutMs);
    try {
      const res = await httpFetch(`${this.cfg.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.ai.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.ai.model,
          messages,
          stream: false,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw AppError.upstreamFailed(`AI 上游返回 ${res.status}：${String(text).slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw AppError.upstreamFailed('AI 上游返回空内容');
      }
      return content;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw AppError.upstreamFailed(`AI 上游请求失败：${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 发起流式请求（返回上游响应对象） */
  private async openStream(messages: UpstreamMessage[], signal: AbortSignal): Promise<any> {
    this.assertAiConfigured();
    try {
      const res = await httpFetch(`${this.cfg.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.ai.apiKey}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.cfg.ai.model,
          messages,
          stream: true,
          temperature: 0.7,
        }),
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw AppError.upstreamFailed(`AI 上游返回 ${res.status}：${String(text).slice(0, 200)}`);
      }
      return res;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw AppError.upstreamFailed(`AI 上游连接失败：${(e as Error).message}`);
    }
  }

  /** 转发上游 SSE 内容增量到客户端，返回完整文本 */
  private async pipeStream(upstream: any, res: Response, sessionId: string): Promise<string> {
    const reader = upstream?.body?.getReader?.();
    if (!reader) throw AppError.upstreamFailed('AI 上游未返回流式响应');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '' || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta !== '') {
            full += delta;
            res.write(`data: ${JSON.stringify({ sessionId, delta, aiGenerated: true })}\n\n`);
          }
        } catch {
          // 上游心跳/非 JSON 行，忽略
        }
      }
    }
    return full;
  }

  /** 加载文章实体（用于对话上下文） */
  private async loadArticles(
    userId: string,
    uuids: string[],
  ): Promise<Array<{ title: string; content: string }>> {
    const rows = await this.prisma.entity.findMany({
      where: { userId, entity: 'article', uuid: { in: uuids }, deleted: false },
    });
    return rows
      .map((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        return {
          title: typeof p.title === 'string' ? p.title : '',
          content: typeof p.content === 'string' ? p.content : '',
        };
      })
      .filter((a) => a.content !== '');
  }

  /** 按字符预算裁剪历史消息（保留最近的内容） */
  private trimHistory(messages: UpstreamMessage[]): UpstreamMessage[] {
    const out: UpstreamMessage[] = [];
    let budget = HISTORY_BUDGET_CHARS;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      const len = m.content.length;
      if (len > budget) {
        if (out.length === 0) out.unshift({ role: m.role, content: m.content.slice(-budget) });
        break;
      }
      out.unshift({ role: m.role, content: m.content });
      budget -= len;
    }
    return out;
  }
}