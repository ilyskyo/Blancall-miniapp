"use strict";
/**
 * AI 历史：训练分析（本地 ai_analysis_history）+ 对话历史（本地会话）
 * 支持单条删除、点击查看（分析纯文本 / 对话续聊）
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const date_1 = require("../../../../core/utils/date");
const indexLogic_1 = require("../ai/indexLogic");
const indexLogic_2 = require("./indexLogic");
let offTheme = null;
function toAnalysisRow(item) {
    return {
        at: item.at,
        title: item.title || '训练分析',
        timeText: (0, date_1.formatFull)(item.at),
        preview: (item.text || '').replace(/\s+/g, ' ').slice(0, 50),
    };
}
Page({
    data: {
        themeStyle: '',
        analyses: [],
        sessions: [],
        // 分析详情
        detailVisible: false,
        detailTitle: '',
        detailText: '',
    },
    onLoad(query) {
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        void query;
        this.reload();
    },
    onShow() {
        this.reload();
    },
    onUnload() {
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    reload() {
        this.setData({
            analyses: (0, indexLogic_2.loadAnalyses)().map(toAnalysisRow),
            sessions: (0, indexLogic_1.listSessions)().map((s) => {
                var _a;
                return ({
                    id: s.id,
                    title: s.title || 'AI 对话',
                    timeText: (0, date_1.formatFull)(s.updatedAt),
                    preview: (((_a = s.messages.find((m) => m.role === 'user')) === null || _a === void 0 ? void 0 : _a.content) || '').replace(/\s+/g, ' ').slice(0, 50),
                    count: s.messages.length,
                });
            }),
        });
    },
    // ============================== 训练分析 ==============================
    onOpenAnalysis(e) {
        const at = Number(e.currentTarget.dataset.at);
        const item = (0, indexLogic_2.loadAnalyses)().find((it) => it.at === at);
        if (!item)
            return;
        this.setData({ detailVisible: true, detailTitle: item.title || '训练分析', detailText: item.text || '' });
    },
    onCloseDetail() {
        this.setData({ detailVisible: false });
    },
    onDeleteAnalysis(e) {
        const at = Number(e.currentTarget.dataset.at);
        wx.showModal({
            title: '删除分析',
            content: '确定删除这条训练分析？',
            confirmText: '删除',
            confirmColor: '#E5484D',
            success: (res) => {
                if (!res.confirm)
                    return;
                (0, indexLogic_2.removeAnalysis)(at);
                this.reload();
                wx.showToast({ title: '已删除', icon: 'none' });
            },
        });
    },
    // ============================== 对话历史 ==============================
    onOpenSession(e) {
        const id = String(e.currentTarget.dataset.id);
        wx.navigateTo({ url: `/packages/ai/pages/ai/index?sessionId=${id}` });
    },
    onDeleteSession(e) {
        const id = String(e.currentTarget.dataset.id);
        wx.showModal({
            title: '删除会话',
            content: '确定删除这段对话？',
            confirmText: '删除',
            confirmColor: '#E5484D',
            success: (res) => {
                if (!res.confirm)
                    return;
                (0, indexLogic_1.removeSession)(id);
                this.reload();
                wx.showToast({ title: '已删除', icon: 'none' });
            },
        });
    },
});
