/**
 * 应用日志：生产环境输出单行 JSON，开发环境输出可读文本
 */
import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';

type Level = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

@Injectable()
export class AppLogger implements NestLoggerService {
  private readonly isProd = process.env.NODE_ENV === 'production';

  private write(level: Level, message: unknown, context?: string, trace?: string): void {
    const ts = new Date().toISOString();
    if (this.isProd) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          ts,
          level,
          context: context ?? null,
          message: typeof message === 'string' ? message : JSON.stringify(message),
          ...(trace ? { trace } : {}),
        }),
      );
      return;
    }
    const label = `[${ts}] ${level.toUpperCase()}${context ? ` (${context})` : ''}`;
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : console.log)(`${label} ${message}`, trace ? `\n${trace}` : '');
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
  setLogLevels(): void {
    // 保持默认级别，不做动态调整
  }
}