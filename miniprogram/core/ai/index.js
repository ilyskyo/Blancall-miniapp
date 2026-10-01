"use strict";
/**
 * AI 能力（当前状态：全部未上线）
 *
 * - 挖空 / 训练分析 / 对话三个入口统一拦截，提示「AI 功能未上线」
 * - 本地算法挖空不受影响（调用方在 AI 不可用时的回退路径保持原样）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTimeout = exports.aiErrorText = exports.startChatStream = exports.requestAnalysis = exports.requestAiCloze = exports.checkAiGate = exports.AI_DISABLED_TEXT = exports.AI_CLOZE_MAX_CHARS = void 0;
const request_1 = require("../net/request");
var cost_1 = require("./cost");
Object.defineProperty(exports, "AI_CLOZE_MAX_CHARS", { enumerable: true, get: function () { return cost_1.AI_CLOZE_MAX_CHARS; } });
/** AI 未上线统一文案 */
exports.AI_DISABLED_TEXT = 'AI 功能未上线，敬请期待';
function aiDisabled() {
    return new request_1.ApiException({ code: 'AI_DISABLED', message: exports.AI_DISABLED_TEXT });
}
/** AI 使用门控（当前恒拦截：AI 未上线） */
function checkAiGate() {
    return { allowed: false, reason: exports.AI_DISABLED_TEXT };
}
exports.checkAiGate = checkAiGate;
/** 调用云端生成挖空坐标（未上线，恒拒绝；调用方回退本地算法） */
async function requestAiCloze(_params) {
    throw aiDisabled();
}
exports.requestAiCloze = requestAiCloze;
/** 训练分析（未上线，恒拒绝） */
async function requestAnalysis(_params) {
    throw aiDisabled();
}
exports.requestAnalysis = requestAnalysis;
/** AI 对话（未上线，恒拒绝） */
function startChatStream(_body, handlers) {
    const timer = setTimeout(() => handlers.onError(aiDisabled()), 0);
    void _body;
    void handlers.onChunk;
    void handlers.onDone;
    return {
        abort: () => clearTimeout(timer),
    };
}
exports.startChatStream = startChatStream;
/** 统一错误文案 */
function aiErrorText(e) {
    if (e instanceof request_1.ApiException)
        return e.message;
    return e instanceof Error ? e.message : exports.AI_DISABLED_TEXT;
}
exports.aiErrorText = aiErrorText;
/** 超时包装（保留给回退场景使用） */
function withTimeout(promise, ms = 40000, message = 'AI 响应超时') {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new request_1.ApiException({ code: 'TIMEOUT', message })), ms);
        promise.then((v) => {
            clearTimeout(timer);
            resolve(v);
        }, (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}
exports.withTimeout = withTimeout;
