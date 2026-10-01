import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError, ERROR_MESSAGES, ErrorCode } from './errors';
import { AppLogger } from './logger';

interface ErrorBody {
  ok: false;
  code: ErrorCode;
  message: string;
  [key: string]: unknown;
}

/** 统一失败响应：{ ok:false, code, message, ...details } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const { status, body } = this.map(exception);

    if (status >= 500) {
      this.logger.error(
        `${body.code} ${body.message}`,
        exception instanceof Error ? exception.stack : String(exception),
        'AllExceptionsFilter',
      );
    }

    res.status(status).json(body);
  }

  private map(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        body: {
          ok: false,
          code: exception.code,
          message: exception.message,
          ...(exception.details ?? {}),
        },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'INVALID_ARGUMENT',
          message: ERROR_MESSAGES.INVALID_ARGUMENT,
          issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const rawMessage =
        typeof resp === 'string'
          ? resp
          : ((resp as Record<string, unknown>).message as string | string[] | undefined);
      const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage;
      let code: ErrorCode = 'INTERNAL_ERROR';
      if (status === 400) code = 'INVALID_ARGUMENT';
      else if (status === 401) code = 'UNAUTHORIZED';
      else if (status === 403) code = 'FORBIDDEN';
      else if (status === 404) code = 'NOT_FOUND';
      else if (status === 413) code = 'INVALID_ARGUMENT';
      else if (status >= 500) code = 'INTERNAL_ERROR';
      return {
        status,
        body: {
          ok: false,
          code,
          message: status === 413 ? '文件超出大小限制' : (message ?? ERROR_MESSAGES[code]),
        },
      };
    }

    // Prisma 已知错误：唯一约束冲突等
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: 409,
          body: { ok: false, code: 'SYNC_CONFLICT', message: '数据已存在（唯一约束冲突）' },
        };
      }
      if (exception.code === 'P2025') {
        return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: ERROR_MESSAGES.NOT_FOUND } };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { ok: false, code: 'INTERNAL_ERROR', message: ERROR_MESSAGES.INTERNAL_ERROR },
    };
  }
}