"use strict";
/**
 * 登录态与云用量（WorkBuddy 云服务版）
 *
 * - 登录：wx.login → cloud.auth.signInWithWechat（SDK 自持久化会话并自动续期）
 * - 本地 SessionState 仅保存资料快照（uid/昵称/头像/过期时间），不承担鉴权职责
 * - 游客：全部本地功能可用（与原产品一致）
 * - 登录用户：云同步 / 上传 / 签到 / 排行
 * - 权益：仅云空间用量与签到积分（产品无付费体系）
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAuthBridge = exports.refreshProfile = exports.requireLogin = exports.spaceInfo = exports.entitlementsSnapshot = exports.loadEntitlements = exports.logout = exports.login = exports.currentUser = exports.currentPlatformName = void 0;
const prefs_1 = require("../storage/prefs");
const config_1 = require("../config");
const request_1 = require("./request");
const cloud_1 = require("./cloud");
const cloudapi_1 = require("./cloudapi");
const telemetry_1 = require("../telemetry");
let entitlementsMemory = null;
let entitlementsFetchedAt = 0;
/** 当前平台（iOS 端微信小程序不支持虚拟商品购买的历史规则已无意义，仅保留平台判定） */
function currentPlatformName() {
    return (0, request_1.currentPlatform)();
}
exports.currentPlatformName = currentPlatformName;
function currentUser() {
    const s = (0, prefs_1.getSession)();
    if (!s)
        return null;
    return {
        id: s.userId,
        nickname: s.nickname,
        avatar: s.avatar,
        rankVisible: (0, prefs_1.getSettings)().rankVisible,
        createdAt: 0,
    };
}
exports.currentUser = currentUser;
/** 微信登录（游客可跳过；触发点：云同步/上传/签到/排行） */
async function login() {
    const code = await new Promise((resolve, reject) => {
        wx.login({
            success: (res) => resolve(res.code || ''),
            fail: (e) => reject(new request_1.ApiException({ code: 'NETWORK_ERROR', message: '微信登录失败', detail: e })),
        });
    });
    if (!code)
        throw new request_1.ApiException({ code: 'NETWORK_ERROR', message: '微信登录失败：无 code' });
    const { data, error } = await (0, cloud_1.cloud)().auth.signInWithWechat(code, cloud_1.WX_APPID);
    if (error || !data)
        throw new request_1.ApiException({ code: 'UNAUTHORIZED', message: (0, cloud_1.cloudErrorText)(error || '登录失败') });
    const uid = data.user.id;
    // 资料行：存在则复用（老用户），不存在则创建（新用户）
    let isNew = false;
    let nickname = (data.user.name || '').trim() || '学习者';
    let avatar = data.user.avatarUrl || '';
    try {
        const existing = await (0, cloudapi_1.upsertMyProfile)({ nickname, avatar, rankVisible: true });
        isNew = existing.isNew;
        if (existing.profile) {
            nickname = existing.profile.nickname || nickname;
            avatar = existing.profile.avatar || avatar;
            (0, prefs_1.updateSettings)({ rankVisible: existing.profile.rankVisible });
        }
    }
    catch {
        /* 资料行操作失败不阻塞登录 */
    }
    (0, prefs_1.setSession)({
        token: data.accessToken,
        expiresAt: data.expiresAt,
        openid: uid,
        userId: uid,
        nickname,
        avatar,
    });
    entitlementsMemory = null;
    (0, telemetry_1.track)('login_success', { isNew });
    return {
        token: data.accessToken,
        expiresAt: data.expiresAt,
        isNew,
        user: { id: uid, nickname, avatar, rankVisible: true, createdAt: 0 },
    };
}
exports.login = login;
async function logout() {
    try {
        await (0, cloud_1.cloud)().auth.signOut();
    }
    catch {
        /* 忽略 */
    }
    (0, prefs_1.setSession)(null);
    entitlementsMemory = null;
    (0, prefs_1.setEntitlementsCache)(null);
}
exports.logout = logout;
/** 获取权益（本地聚合云用量与签到；带 10 分钟缓存；未登录返回 null） */
async function loadEntitlements(force = false) {
    if (!(0, prefs_1.isLoggedIn)())
        return null;
    if (!force && entitlementsMemory && Date.now() - entitlementsFetchedAt < config_1.ENTITLEMENT_CACHE_MS) {
        return entitlementsMemory;
    }
    if (!force) {
        const cached = (0, prefs_1.getEntitlementsCache)();
        if (cached && Date.now() - cached.fetchedAt < config_1.ENTITLEMENT_CACHE_MS && cached.data) {
            entitlementsMemory = cached.data;
            entitlementsFetchedAt = cached.fetchedAt;
            return entitlementsMemory;
        }
    }
    let space = { baseBytes: config_1.FREE_SPACE_BASE_BYTES, grantBytes: 0, usedBytes: 0, totalBytes: config_1.FREE_SPACE_BASE_BYTES };
    let streak = { current: 0, longest: 0, checkedInToday: false };
    let credits = 0;
    try {
        const [usage, s] = await Promise.all([(0, cloudapi_1.fetchSpaceUsage)(), (0, cloudapi_1.fetchStreakSummary)()]);
        if (usage)
            space = usage;
        if (s) {
            streak = s.streak;
            credits = s.credits;
        }
    }
    catch {
        /* 聚合失败给默认值，下次再刷 */
    }
    const data = { space, credits, streak };
    entitlementsMemory = data;
    entitlementsFetchedAt = Date.now();
    (0, prefs_1.setEntitlementsCache)(data);
    return data;
}
exports.loadEntitlements = loadEntitlements;
/** 同步读取权益快照（页面首帧用；无缓存则返回 null） */
function entitlementsSnapshot() {
    if (entitlementsMemory)
        return entitlementsMemory;
    const cached = (0, prefs_1.getEntitlementsCache)();
    if (cached && cached.data) {
        entitlementsMemory = cached.data;
        entitlementsFetchedAt = cached.fetchedAt;
    }
    return entitlementsMemory;
}
exports.entitlementsSnapshot = entitlementsSnapshot;
// ============================== 空间用量 ==============================
/** 云空间信息 */
function spaceInfo() {
    const ent = entitlementsSnapshot();
    return ent ? ent.space : null;
}
exports.spaceInfo = spaceInfo;
/** 需要登录时的统一提示（带跳转） */
function requireLogin(options = {}) {
    if ((0, prefs_1.isLoggedIn)())
        return true;
    wx.showModal({
        title: '需要登录',
        content: '该功能需要登录后使用（基础背诵功能无需登录）',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
            if (res.confirm) {
                login()
                    .then(() => {
                    if (options.redirect)
                        wx.navigateTo({ url: options.redirect });
                    else
                        wx.showToast({ title: '登录成功', icon: 'success' });
                })
                    .catch((e) => wx.showToast({ title: e.message || '登录失败', icon: 'none' }));
            }
        },
    });
    return false;
}
exports.requireLogin = requireLogin;
/** 刷新用户资料到本地会话（user_profile 为权威） */
async function refreshProfile() {
    if (!(0, prefs_1.isLoggedIn)())
        return null;
    const { getMyProfile } = await Promise.resolve().then(() => __importStar(require('./cloudapi')));
    const { profile } = await getMyProfile();
    if (!profile)
        return null;
    const s = (0, prefs_1.getSession)();
    if (s)
        (0, prefs_1.setSession)({ ...s, userId: profile.id, nickname: profile.nickname, avatar: profile.avatar || '', openid: profile.id });
    (0, prefs_1.updateSettings)({ rankVisible: profile.rankVisible });
    return {
        id: profile.id,
        nickname: profile.nickname,
        avatar: profile.avatar || '',
        rankVisible: profile.rankVisible,
        createdAt: 0,
    };
}
exports.refreshProfile = refreshProfile;
/**
 * 桥接 SDK 登录态 → 本地 SessionState（app 启动时调用一次）
 * - TOKEN_REFRESHED：同步续期后的过期时间，避免 isLoggedIn() 误判过期
 * - SIGNED_OUT：清本地会话
 */
function initAuthBridge() {
    try {
        (0, cloud_1.cloud)().auth.onAuthStateChange((event, session) => {
            if (event === 'TOKEN_REFRESHED' && session) {
                const s = (0, prefs_1.getSession)();
                if (s && s.userId === session.user.id) {
                    (0, prefs_1.setSession)({ ...s, token: session.accessToken, expiresAt: session.expiresAt });
                }
            }
            else if (event === 'SIGNED_OUT') {
                (0, prefs_1.setSession)(null);
                entitlementsMemory = null;
                (0, prefs_1.setEntitlementsCache)(null);
            }
        });
    }
    catch (e) {
        console.warn('[auth] initAuthBridge 失败', e);
    }
}
exports.initAuthBridge = initAuthBridge;
