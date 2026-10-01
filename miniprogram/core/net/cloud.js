"use strict";
/**
 * 云服务接入层（单例）
 *
 * - 数据面：自建/托管云服务的固定网关地址
 * - 身份：cloud.auth 是唯一身份来源，accessToken 由 SDK 自持久化并自动续期，
 *   database/storage 请求自动携带会话，调用方不需要（也不应该）手动搬 token。
 * - 诊断：utils/workbuddy-cloud-diagnostics.js 包装 wx，失败请求输出诊断日志。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloudErrorText = exports.cloud = exports.WX_APPID = exports.CLOUD_PUBLISHABLE_KEY = exports.CLOUD_ENDPOINT = void 0;
// @ts-ignore — 运行时经「构建 npm」解析为 miniprogram_npm 包内 miniprogram.js；
// 类型经 tsconfig paths 映射到 SDK 自带的 miniprogram.d.ts
const miniprogram_1 = require("@tencent-ai/workbuddy-cloud-sdk/miniprogram");
const workbuddy_cloud_diagnostics_1 = require("../../utils/workbuddy-cloud-diagnostics");
/** 云服务网关地址（开源仓库为占位符：替换为你自己云服务开通时下发的 endpoint） */
exports.CLOUD_ENDPOINT = 'https://YOUR_CLOUD_ENDPOINT.example';
/** 云服务 publishable key（客户端凭证，非机密；开源仓库为占位符，替换为你自己的 key） */
exports.CLOUD_PUBLISHABLE_KEY = 'wbpk_YOUR_PUBLISHABLE_KEY_HERE';
/** 微信小程序 AppID（cloud.auth.signInWithWechat 需要；替换为你自己的 AppID） */
exports.WX_APPID = 'wxYOUR_APPID_HERE';
let client = null;
/** 云客户端单例（初始化一次，auth/database/storage 共用） */
function cloud() {
    if (!client) {
        client = (0, miniprogram_1.createMiniProgramWorkBuddyCloud)({
            endpoint: exports.CLOUD_ENDPOINT,
            publishableKey: exports.CLOUD_PUBLISHABLE_KEY,
            wx: (0, workbuddy_cloud_diagnostics_1.createDiagnosticWx)(),
        });
    }
    return client;
}
exports.cloud = cloud;
/** 把 SDK/数据库错误转成用户可读文案 */
function cloudErrorText(e) {
    const anyErr = e;
    const msg = anyErr && anyErr.message ? String(anyErr.message) : '';
    if (/JWT|expired|invalid claim|Auth session/i.test(msg))
        return '登录已过期，请重新登录';
    if (/row-level security|permission denied|42501/i.test(msg + (anyErr && anyErr.code ? String(anyErr.code) : ''))) {
        return '没有权限执行该操作';
    }
    if (/Failed to fetch|network|request:fail/i.test(msg))
        return '网络异常，请检查网络后重试';
    return msg || '操作失败，请稍后重试';
}
exports.cloudErrorText = cloudErrorText;
