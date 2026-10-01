/**
 * 埋点（匿名、批量、静默失败）
 *
 * 合规约束：
 * - 只上报事件名 + 少量数值/枚举属性；**绝不**上报文章标题、正文、用户名、openid 等可识别信息
 * - 不含设备指纹、位置、通讯录等
 * - 上报失败静默忽略，绝不影响主流程
 *
 * 批量策略：事件入内存队列，满 10 条或每 30 秒 flush 一次；页面 onHide 时立即 flush。
 */

import { cloud } from '../net/cloud';
import { getSettings, isLoggedIn, onSettingsChange } from '../storage/prefs';

export type EventName =
  | 'session_start'
  | 'article_import'
  | 'practice_start'
  | 'practice_complete'
  | 'practice_resume'
  | 'ai_cloze'
  | 'ai_analysis'
  | 'ai_chat'
  | 'reader_open'
  | 'occlusion_toggle'
  | 'login_success'
  | 'checkin'
  | 'library_import'
  | 'export_action'
  | 'sync_result';

interface QueuedEvent {
  name: EventName;
  ts: number;
  props?: Record<string, string | number | boolean>;
}

const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30000;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let disabled = false;

/** 初始化：跟随设置里的「匿名使用统计」开关（默认开启，用户可关闭） */
export function initTelemetry(): void {
  disabled = !getSettings().telemetryEnabled;
  onSettingsChange((s) => {
    if (!s.telemetryEnabled) {
      disabled = true;
      queue = [];
    } else {
      disabled = false;
    }
  });
}

/** 关闭埋点（隐私偏好） */
export function disableTelemetry(): void {
  disabled = true;
  queue = [];
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/** 立即上报队列（仅登录用户；匿名事件不上报） */
export async function flush(): Promise<void> {
  if (queue.length === 0) return;
  if (!isLoggedIn()) {
    queue = [];
    return;
  }
  const batch = queue.slice(0, 100);
  queue = queue.slice(batch.length);
  try {
    const rows = batch.map((e) => ({ name: e.name, props: e.props || null, client_ts: e.ts }));
    const { error } = await cloud().database.from('telemetry_events').insert(rows);
    if (error) throw error;
  } catch {
    // 失败不重试（避免占用用户网络），直接丢弃
  }
}

/**
 * 记录一个事件
 * @param props 只放数值/枚举，例如 { mode: 'WORD', blanks: 12, chars: 480 }
 */
export function track(name: EventName, props?: Record<string, string | number | boolean>): void {
  if (disabled) return;
  queue.push({ name, ts: Date.now(), props: sanitize(props) });
  if (queue.length >= FLUSH_SIZE) {
    void flush();
    return;
  }
  scheduleFlush();
}

/** 过滤超长/可疑属性，防止误传正文等敏感内容 */
function sanitize(props?: Record<string, string | number | boolean>): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      continue;
    }
    if (typeof v === 'string') {
      // 字符串属性仅允许短枚举值；超长则截断为长度，避免正文泄漏
      out[k] = v.length <= 24 ? v : `len:${v.length}`;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 字数分档（避免上报精确字数，兼顾统计与隐私） */
export function charsBucket(chars: number): string {
  if (chars < 500) return '<500';
  if (chars < 2000) return '500-2k';
  if (chars < 10000) return '2k-10k';
  return '>10k';
}