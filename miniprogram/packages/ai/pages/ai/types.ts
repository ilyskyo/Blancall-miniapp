/**
 * AI 会话共享类型
 */

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: AiMessage[];
}