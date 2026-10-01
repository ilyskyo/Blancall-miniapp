"use strict";
/**
 * AI 历史纯逻辑：训练分析本地列表（ai_analysis_history，最多 50 条，兼容 last_analysis）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendAnalysis = exports.removeAnalysis = exports.loadAnalyses = void 0;
const KEY_ANALYSIS = 'ai_analysis_history';
const KEY_LAST = 'last_analysis';
const MAX_ANALYSES = 50;
function readArray() {
    try {
        const v = wx.getStorageSync(KEY_ANALYSIS);
        if (Array.isArray(v))
            return v;
        return [];
    }
    catch {
        return [];
    }
}
function writeArray(items) {
    try {
        wx.setStorageSync(KEY_ANALYSIS, items.slice(0, MAX_ANALYSES));
    }
    catch (e) {
        console.error('[ai-history] 写入分析历史失败', e);
    }
}
/** 读取分析历史；把 result 页写入的 last_analysis 合并进数组（去重，最多 50 条） */
function loadAnalyses() {
    let items = readArray();
    try {
        const last = wx.getStorageSync(KEY_LAST);
        if (last && last.text && last.at && !items.some((it) => it.at === last.at)) {
            items = [{ at: last.at, title: last.title || '', text: last.text }, ...items];
            writeArray(items);
        }
    }
    catch {
        /* 忽略 */
    }
    return items.slice().sort((a, b) => b.at - a.at).slice(0, MAX_ANALYSES);
}
exports.loadAnalyses = loadAnalyses;
/** 删除一条分析 */
function removeAnalysis(at) {
    const items = readArray().filter((it) => it.at !== at);
    writeArray(items);
    return items.slice().sort((a, b) => b.at - a.at);
}
exports.removeAnalysis = removeAnalysis;
/** 追加一条分析（供后续扩展：结果页写入） */
function appendAnalysis(item) {
    const items = readArray().filter((it) => it.at !== item.at);
    items.unshift(item);
    writeArray(items);
}
exports.appendAnalysis = appendAnalysis;
