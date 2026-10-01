/**
 * AI 会话本地存储与消息视图工具（AI 对话页 / 历史页共用）
 * 本地键：`ai_sessions/<id>`（与需求一致），存储结构 { id, title, updatedAt, messages }
 */

import { AiMessage, AiSession } from './types';
export type { AiMessage, AiSession } from './types';

const PREFIX = 'ai_sessions/';

export function sessionKey(id: string): string {
  return `${PREFIX}${id}`;
}

/** 保存会话（本地权威副本） */
export function saveSession(session: AiSession): void {
  try {
    wx.setStorageSync(sessionKey(session.id), session);
  } catch (e) {
    console.error('[ai] 保存会话失败', e);
  }
}

/** 读取会话 */
export function loadSession(id: string): AiSession | null {
  try {
    const v = wx.getStorageSync(sessionKey(id));
    if (v && typeof v === 'object' && Array.isArray((v as AiSession).messages)) return v as AiSession;
    return null;
  } catch {
    return null;
  }
}

/** 列出全部本地会话（按更新时间倒序） */
export function listSessions(): AiSession[] {
  try {
    const info = wx.getStorageInfoSync();
    const keys = info.keys || [];
    const out: AiSession[] = [];
    for (const key of keys) {
      if (key.indexOf(PREFIX) !== 0) continue;
      const s = loadSession(key.slice(PREFIX.length));
      if (s) out.push(s);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** 删除会话 */
export function removeSession(id: string): void {
  try {
    wx.removeStorageSync(sessionKey(id));
  } catch (e) {
    console.error('[ai] 删除会话失败', e);
  }
}

/** 会话标题：取首条用户消息前 16 字 */
export function sessionTitle(messages: AiMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'AI 对话';
  return first.content.slice(0, 16) || 'AI 对话';
}

export interface MessageView {
  id: number;
  anchor: string;
  index: number;
  text: string;
  bubbleCls: string;
  showAiLabel: boolean;
  error: boolean;
}

/** 消息列表 → 视图（cls 预计算） */
export function buildMessageViews(messages: AiMessage[], errorIndex: number): MessageView[] {
  return messages.map((m, index) => ({
    id: index,
    anchor: `m${index}`,
    index,
    text: m.content,
    bubbleCls: m.role === 'user' ? 'bubble bubble--user' : 'bubble bubble--ai',
    showAiLabel: m.role === 'assistant' && m.content.length > 0,
    error: index === errorIndex,
  }));
}

/** 传给服务端的消息（含当前进行中的助手文本） */
export function toApiMessages(messages: AiMessage[]): Array<{ role: string; content: string }> {
  return messages.filter((m) => m.content.length > 0).map((m) => ({ role: m.role, content: m.content }));
}