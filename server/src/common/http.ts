/**
 * 极简 HTTP 客户端封装：直接使用 Node 18+ 内置 fetch，
 * 不做强类型约束以规避 @types/node 对 fetch 声明差异。
 */
import { AppError } from './errors';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyResponse = any;
export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}

function getFetch(): (url: string, init?: HttpInit) => Promise<AnyResponse> {
  const f = (globalThis as unknown as { fetch?: (u: string, i?: HttpInit) => Promise<AnyResponse> }).fetch;
  if (typeof f !== 'function') {
    throw AppError.upstreamFailed('当前运行时缺少内置 fetch，请使用 Node 18+');
  }
  return f;
}

export function httpFetch(url: string, init?: HttpInit): Promise<AnyResponse> {
  return getFetch()(url, init ?? {});
}

/** 带超时的 fetch；超时抛 UPSTREAM_FAILED */
export async function httpFetchWithTimeout(
  url: string,
  init: HttpInit,
  timeoutMs: number,
): Promise<AnyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await httpFetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    throw AppError.upstreamFailed(`上游请求失败：${msg}`);
  } finally {
    clearTimeout(timer);
  }
}