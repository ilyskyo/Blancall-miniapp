/**
 * 服务端数据类型定义（与 docs/02-接口规范.md 对应）
 *
 * 注：网络传输层已接入 WorkBuddy 云服务（见 net/cloud.ts 与 net/cloudapi.ts），
 * 本文件仅保留数据结构类型，供各模块 import。
 */

import { PracticeMode } from '../algorithms/types';

// ---------------- 类型 ----------------

export interface UserProfile {
  id: string;
  nickname: string;
  avatar: string;
  rankVisible: boolean;
  createdAt: number;
}

export interface LoginResult {
  token: string;
  expiresAt: number;
  user: UserProfile;
  isNew: boolean;
}

export interface Entitlements {
  space: { baseBytes: number; grantBytes: number; usedBytes: number; totalBytes: number };
  credits: number;
  streak: { current: number; longest: number; checkedInToday: boolean };
}

export interface SyncPushBody {
  deviceId: string;
  ops: Array<{ entity: string; op: 'upsert' | 'delete'; uuid: string; updatedAt: number; payload?: unknown }>;
}

export interface SyncPushResult {
  results: Array<{ entity: string; uuid: string; status: 'applied' | 'conflict'; rev: number; serverUpdatedAt: number }>;
  serverTime: number;
}

export interface SyncPullResult {
  items: Array<{ entity: string; uuid: string; op: 'upsert' | 'delete'; updatedAt: number; payload?: unknown; rev: number }>;
  nextCursor: string;
  hasMore: boolean;
}

export interface UploadedDocument {
  id: string;
  name: string;
  ext: string;
  size: number;
  status: 'uploaded' | 'parsed' | 'failed';
}

export interface ParsedDocument {
  title: string;
  paragraphs: string[];
  plainText: string;
}

export interface UploadedFont {
  id: string;
  family: string;
  url: string;
  size: number;
}

export interface SpaceUsage {
  usedBytes: number;
  baseBytes: number;
  grantBytes: number;
  totalBytes: number;
  items: Array<{ type: string; size: number }>;
}

export interface CheckinResult {
  credits: number;
  streak: { current: number; longest: number };
}

export interface CheckinCalendar {
  days: Array<{ date: string; checkedIn: boolean }>;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  isMe?: boolean;
}

export interface LeaderboardResult {
  top: LeaderboardEntry[];
  me: { rank: number; score: number } | null;
}

/** 本地练习模式类型再导出（兼容旧 import 路径） */
export type { PracticeMode };
