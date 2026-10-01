/**
 * AI 能力（当前状态：全部未上线）
 *
 * - 挖空 / 训练分析 / 对话三个入口统一拦截，提示「AI 功能未上线」
 * - 本地算法挖空不受影响（调用方在 AI 不可用时的回退路径保持原样）
 */

import { ApiException } from '../net/request';
import { AI_CLOZE_MAX_CHARS } from './cost';

export { AI_CLOZE_MAX_CHARS } from './cost';

export interface AiCoordsResult {
  coords: number[] | Array<{ sentence: number; start: number; end: number }>;
  aiGenerated: boolean;
}

export interface AiGate {
  allowed: boolean;
  reason?: string;
}

/** AI 未上线统一文案 */
export const AI_DISABLED_TEXT = 'AI 功能未上线，敬请期待';

function aiDisabled(): ApiException {
  return new ApiException({ code: 'AI_DISABLED', message: AI_DISABLED_TEXT });
}

/** AI 使用门控（当前恒拦截：AI 未上线） */
export function checkAiGate(): AiGate {
  return { allowed: false, reason: AI_DISABLED_TEXT };
}

/** 调用云端生成挖空坐标（未上线，恒拒绝；调用方回退本地算法） */
export async function requestAiCloze(_params: {
  articleText: string;
  mode: string;
  strategy: string;
  level?: number;
  extra?: string;
}): Promise<AiCoordsResult> {
  throw aiDisabled();
}

/** 训练分析（未上线，恒拒绝） */
export async function requestAnalysis(_params: {
  title: string;
  mode: string;
  accuracy: number;
  mistakes: Array<{ correctAnswer: string; userAnswer: string; errorType: string }>;
  weakHints: number;
  strongHints: number;
}): Promise<string> {
  throw aiDisabled();
}

/** AI 对话（未上线，恒拒绝） */
export function startChatStream(
  _body: { sessionId: string; articleUuids: string[]; messages: Array<{ role: string; content: string }> },
  handlers: { onChunk: (t: string) => void; onDone: () => void; onError: (e: Error) => void }
): { abort: () => void } {
  const timer = setTimeout(() => handlers.onError(aiDisabled()), 0);
  void _body;
  void handlers.onChunk;
  void handlers.onDone;
  return {
    abort: () => clearTimeout(timer),
  };
}

/** 统一错误文案 */
export function aiErrorText(e: unknown): string {
  if (e instanceof ApiException) return e.message;
  return e instanceof Error ? e.message : AI_DISABLED_TEXT;
}

/** 超时包装（保留给回退场景使用） */
export function withTimeout<T>(promise: Promise<T>, ms = 40000, message = 'AI 响应超时'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiException({ code: 'TIMEOUT', message })), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
