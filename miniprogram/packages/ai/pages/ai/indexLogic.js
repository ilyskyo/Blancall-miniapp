"use strict";
/**
 * AI 会话本地存储与消息视图工具（AI 对话页 / 历史页共用）
 * 本地键：`ai_sessions/<id>`（与需求一致），存储结构 { id, title, updatedAt, messages }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toApiMessages = exports.buildMessageViews = exports.sessionTitle = exports.removeSession = exports.listSessions = exports.loadSession = exports.saveSession = exports.sessionKey = void 0;
const PREFIX = 'ai_sessions/';
function sessionKey(id) {
    return `${PREFIX}${id}`;
}
exports.sessionKey = sessionKey;
/** 保存会话（本地权威副本） */
function saveSession(session) {
    try {
        wx.setStorageSync(sessionKey(session.id), session);
    }
    catch (e) {
        console.error('[ai] 保存会话失败', e);
    }
}
exports.saveSession = saveSession;
/** 读取会话 */
function loadSession(id) {
    try {
        const v = wx.getStorageSync(sessionKey(id));
        if (v && typeof v === 'object' && Array.isArray(v.messages))
            return v;
        return null;
    }
    catch {
        return null;
    }
}
exports.loadSession = loadSession;
/** 列出全部本地会话（按更新时间倒序） */
function listSessions() {
    try {
        const info = wx.getStorageInfoSync();
        const keys = info.keys || [];
        const out = [];
        for (const key of keys) {
            if (key.indexOf(PREFIX) !== 0)
                continue;
            const s = loadSession(key.slice(PREFIX.length));
            if (s)
                out.push(s);
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    catch {
        return [];
    }
}
exports.listSessions = listSessions;
/** 删除会话 */
function removeSession(id) {
    try {
        wx.removeStorageSync(sessionKey(id));
    }
    catch (e) {
        console.error('[ai] 删除会话失败', e);
    }
}
exports.removeSession = removeSession;
/** 会话标题：取首条用户消息前 16 字 */
function sessionTitle(messages) {
    const first = messages.find((m) => m.role === 'user');
    if (!first)
        return 'AI 对话';
    return first.content.slice(0, 16) || 'AI 对话';
}
exports.sessionTitle = sessionTitle;
/** 消息列表 → 视图（cls 预计算） */
function buildMessageViews(messages, errorIndex) {
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
exports.buildMessageViews = buildMessageViews;
/** 传给服务端的消息（含当前进行中的助手文本） */
function toApiMessages(messages) {
    return messages.filter((m) => m.content.length > 0).map((m) => ({ role: m.role, content: m.content }));
}
exports.toApiMessages = toApiMessages;
