import { Body, Controller, Delete, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, SkipResponseWrap } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { parseZod } from '../common/zod.util';
import { AiService } from './ai.service';
import { analysisSchema, chatSchema, clozeSchema, type AnalysisBody, type ChatBody, type ClozeBody } from './ai.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** POST /ai/cloze → { coords } */
  @Post('cloze')
  async cloze(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto: ClozeBody = parseZod(clozeSchema, body);
    return this.ai.cloze(user.id, user.openid, dto);
  }

  /** POST /ai/analysis → { markdown } */
  @Post('analysis')
  async analysis(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto: AnalysisBody = parseZod(analysisSchema, body);
    return this.ai.analysis(user.id, user.openid, dto);
  }

  /**
   * POST /ai/chat → 分块响应（Transfer-Encoding: chunked）
   * 每个分块形如：data: {"sessionId":"...","delta":"文本","aiGenerated":true}\n\n
   * 结束分块：data: {"sessionId":"...","done":true,"aiGenerated":true}\n\n
   */
  @SkipResponseWrap()
  @Post('chat')
  async chat(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const dto: ChatBody = parseZod(chatSchema, body);
    await this.ai.chat(user.id, user.openid, dto, res);
  }

  /** GET /ai/sessions */
  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    return this.ai.listSessions(user.id);
  }

  /** GET /ai/sessions/:id */
  @Get('sessions/:id')
  async session(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.getSession(user.id, id);
  }

  /** DELETE /ai/sessions/:id */
  @Delete('sessions/:id')
  async removeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.deleteSession(user.id, id);
  }
}