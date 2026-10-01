/**
 * 登录态与云用量（WorkBuddy 云服务版）
 *
 * - 登录：wx.login → cloud.auth.signInWithWechat（SDK 自持久化会话并自动续期）
 * - 本地 SessionState 仅保存资料快照（uid/昵称/头像/过期时间），不承担鉴权职责
 * - 游客：全部本地功能可用（与原产品一致）
 * - 登录用户：云同步 / 上传 / 签到 / 排行
 * - 权益：仅云空间用量与签到积分（产品无付费体系）
 */

import { Entitlements, LoginResult, UserProfile } from './api';
import {
  getEntitlementsCache,
  getSettings,
  getSession,
  isLoggedIn,
  setEntitlementsCache,
  setSession,
  updateSettings,
} from '../storage/prefs';
import { ENTITLEMENT_CACHE_MS, FREE_SPACE_BASE_BYTES } from '../config';
import { currentPlatform, ApiException } from './request';
import { cloud, cloudErrorText, WX_APPID } from './cloud';
import { fetchSpaceUsage, fetchStreakSummary, upsertMyProfile } from './cloudapi';
import { track } from '../telemetry';

export interface AuthState {
  loggedIn: boolean;
  user: UserProfile | null;
  entitlements: Entitlements | null;
  lastError?: string;
}

let entitlementsMemory: Entitlements | null = null;
let entitlementsFetchedAt = 0;

/** 当前平台（iOS 端微信小程序不支持虚拟商品购买的历史规则已无意义，仅保留平台判定） */
export function currentPlatformName(): string {
  return currentPlatform();
}

export function currentUser(): UserProfile | null {
  const s = getSession();
  if (!s) return null;
  return {
    id: s.userId,
    nickname: s.nickname,
    avatar: s.avatar,
    rankVisible: getSettings().rankVisible,
    createdAt: 0,
  };
}

/** 微信登录（游客可跳过；触发点：云同步/上传/签到/排行） */
export async function login(): Promise<LoginResult> {
  const code = await new Promise<string>((resolve, reject) => {
    wx.login({
      success: (res) => resolve(res.code || ''),
      fail: (e) => reject(new ApiException({ code: 'NETWORK_ERROR', message: '微信登录失败', detail: e })),
    });
  });
  if (!code) throw new ApiException({ code: 'NETWORK_ERROR', message: '微信登录失败：无 code' });

  const { data, error } = await cloud().auth.signInWithWechat(code, WX_APPID);
  if (error || !data) throw new ApiException({ code: 'UNAUTHORIZED', message: cloudErrorText(error || '登录失败') });

  const uid = data.user.id;
  // 资料行：存在则复用（老用户），不存在则创建（新用户）
  let isNew = false;
  let nickname = (data.user.name || '').trim() || '学习者';
  let avatar = data.user.avatarUrl || '';
  try {
    const existing = await upsertMyProfile({ nickname, avatar, rankVisible: true });
    isNew = existing.isNew;
    if (existing.profile) {
      nickname = existing.profile.nickname || nickname;
      avatar = existing.profile.avatar || avatar;
      updateSettings({ rankVisible: existing.profile.rankVisible });
    }
  } catch {
    /* 资料行操作失败不阻塞登录 */
  }

  setSession({
    token: data.accessToken,
    expiresAt: data.expiresAt,
    openid: uid,
    userId: uid,
    nickname,
    avatar,
  });
  entitlementsMemory = null;
  track('login_success', { isNew });
  return {
    token: data.accessToken,
    expiresAt: data.expiresAt,
    isNew,
    user: { id: uid, nickname, avatar, rankVisible: true, createdAt: 0 },
  };
}

export async function logout(): Promise<void> {
  try {
    await cloud().auth.signOut();
  } catch {
    /* 忽略 */
  }
  setSession(null);
  entitlementsMemory = null;
  setEntitlementsCache<Entitlements | null>(null);
}

/** 获取权益（本地聚合云用量与签到；带 10 分钟缓存；未登录返回 null） */
export async function loadEntitlements(force = false): Promise<Entitlements | null> {
  if (!isLoggedIn()) return null;
  if (!force && entitlementsMemory && Date.now() - entitlementsFetchedAt < ENTITLEMENT_CACHE_MS) {
    return entitlementsMemory;
  }
  if (!force) {
    const cached = getEntitlementsCache<Entitlements>();
    if (cached && Date.now() - cached.fetchedAt < ENTITLEMENT_CACHE_MS && cached.data) {
      entitlementsMemory = cached.data;
      entitlementsFetchedAt = cached.fetchedAt;
      return entitlementsMemory;
    }
  }
  let space = { baseBytes: FREE_SPACE_BASE_BYTES, grantBytes: 0, usedBytes: 0, totalBytes: FREE_SPACE_BASE_BYTES };
  let streak = { current: 0, longest: 0, checkedInToday: false };
  let credits = 0;
  try {
    const [usage, s] = await Promise.all([fetchSpaceUsage(), fetchStreakSummary()]);
    if (usage) space = usage;
    if (s) {
      streak = s.streak;
      credits = s.credits;
    }
  } catch {
    /* 聚合失败给默认值，下次再刷 */
  }
  const data: Entitlements = { space, credits, streak };
  entitlementsMemory = data;
  entitlementsFetchedAt = Date.now();
  setEntitlementsCache(data);
  return data;
}

/** 同步读取权益快照（页面首帧用；无缓存则返回 null） */
export function entitlementsSnapshot(): Entitlements | null {
  if (entitlementsMemory) return entitlementsMemory;
  const cached = getEntitlementsCache<Entitlements>();
  if (cached && cached.data) {
    entitlementsMemory = cached.data;
    entitlementsFetchedAt = cached.fetchedAt;
  }
  return entitlementsMemory;
}

// ============================== 空间用量 ==============================

/** 云空间信息 */
export function spaceInfo(): Entitlements['space'] | null {
  const ent = entitlementsSnapshot();
  return ent ? ent.space : null;
}

/** 需要登录时的统一提示（带跳转） */
export function requireLogin(options: { redirect?: string } = {}): boolean {
  if (isLoggedIn()) return true;
  wx.showModal({
    title: '需要登录',
    content: '该功能需要登录后使用（基础背诵功能无需登录）',
    confirmText: '去登录',
    cancelText: '取消',
    success: (res) => {
      if (res.confirm) {
        login()
          .then(() => {
            if (options.redirect) wx.navigateTo({ url: options.redirect as string });
            else wx.showToast({ title: '登录成功', icon: 'success' });
          })
          .catch((e: Error) => wx.showToast({ title: e.message || '登录失败', icon: 'none' }));
      }
    },
  });
  return false;
}

/** 刷新用户资料到本地会话（user_profile 为权威） */
export async function refreshProfile(): Promise<UserProfile | null> {
  if (!isLoggedIn()) return null;
  const { getMyProfile } = await import('./cloudapi');
  const { profile } = await getMyProfile();
  if (!profile) return null;
  const s = getSession();
  if (s) setSession({ ...s, userId: profile.id, nickname: profile.nickname, avatar: profile.avatar || '', openid: profile.id });
  updateSettings({ rankVisible: profile.rankVisible });
  return {
    id: profile.id,
    nickname: profile.nickname,
    avatar: profile.avatar || '',
    rankVisible: profile.rankVisible,
    createdAt: 0,
  };
}

/**
 * 桥接 SDK 登录态 → 本地 SessionState（app 启动时调用一次）
 * - TOKEN_REFRESHED：同步续期后的过期时间，避免 isLoggedIn() 误判过期
 * - SIGNED_OUT：清本地会话
 */
export function initAuthBridge(): void {
  try {
    cloud().auth.onAuthStateChange(
      (event: string, session: { accessToken: string; expiresAt: number; user: { id: string } } | null) => {
        if (event === 'TOKEN_REFRESHED' && session) {
          const s = getSession();
          if (s && s.userId === session.user.id) {
            setSession({ ...s, token: session.accessToken, expiresAt: session.expiresAt });
          }
        } else if (event === 'SIGNED_OUT') {
          setSession(null);
          entitlementsMemory = null;
          setEntitlementsCache<Entitlements | null>(null);
        }
      }
    );
  } catch (e) {
    console.warn('[auth] initAuthBridge 失败', e);
  }
}
