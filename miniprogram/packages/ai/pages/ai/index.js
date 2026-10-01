"use strict";
/**
 * AI 对话：多篇上下文问答（最多 3 篇）、流式输出、AI 生成标识、额度门控、本地会话落库
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const entities_1 = require("../../../../core/storage/entities");
const ai_1 = require("../../../../core/ai");
const auth_1 = require("../../../../core/net/auth");
const prefs_1 = require("../../../../core/storage/prefs");
const uuid_1 = require("../../../../core/utils/uuid");
const indexLogic_1 = require("./indexLogic");
let offTheme = null;
let sessionId = '';
let allMessages = [];
let errorIndex = -1;
let abortTask = null;
Page({
    /** 页面已销毁标记：异步回调中阻止 setData */
    __destroyed: false,
    data: {
        themeStyle: '',
        messages: [],
        inputValue: '',
        sending: false,
        sendText: '发送',
        sendCls: 'btn btn--primary btn--sm',
        ctxText: '未选择',
        aiAllowed: true,
        gateReason: '',
        lockVisible: false,
        scrollInto: '',
        showPicker: false,
        articleOptions: [],
        selectedUuids: [],
    },
    async onLoad(query) {
        this.__destroyed = false;
        sessionId = query.sessionId || (0, uuid_1.uuidv7)();
        allMessages = [];
        errorIndex = -1;
        this.setData({ themeStyle: (0, theme_1.themeStyle)(), messages: [] });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        // 上下文：ids 参数优先，否则默认最近一篇
        const articles = this.sortedArticles();
        const idsParam = (query.ids || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => !!s && articles.some((a) => a.uuid === s))
            .slice(0, 3);
        const selected = idsParam.length > 0 ? idsParam : articles.length > 0 ? [articles[0].uuid] : [];
        this.setData({ selectedUuids: selected, articleOptions: this.buildOptions(selected), ctxText: this.ctxTextOf(selected) });
        if (query.sessionId)
            await this.loadExisting(query.sessionId);
        this.refreshGate();
        if ((0, prefs_1.isLoggedIn)()) {
            void (0, auth_1.loadEntitlements)()
                .then(() => this.refreshGate())
                .catch(() => undefined);
        }
    },
    onShow() {
        this.refreshGate();
    },
    onUnload() {
        this.__destroyed = true;
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
        if (abortTask) {
            abortTask.abort();
            abortTask = null;
        }
        this.persist();
    },
    // ============================== 数据辅助 ==============================
    sortedArticles() {
        return entities_1.articleStore.list().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    buildOptions(selected) {
        return this.sortedArticles().map((a) => {
            const checked = selected.indexOf(a.uuid) >= 0;
            return {
                uuid: a.uuid,
                title: a.title || '未命名',
                checked,
                cls: checked ? 'picker-check--on' : '',
                mark: checked ? '✓' : '',
            };
        });
    },
    ctxTextOf(selected) {
        if (selected.length === 0)
            return '未选择';
        const titles = selected.map((uuid) => {
            const a = entities_1.articleStore.find(uuid);
            return a ? a.title : '已删除文章';
        });
        return titles.join('、');
    },
    /** 载入历史会话（AI 未上线：仅本地会话，无服务端存储） */
    async loadExisting(id) {
        const local = (0, indexLogic_1.loadSession)(id);
        if (local) {
            allMessages = local.messages.slice();
            this.render(true);
        }
    },
    refreshGate() {
        if (this.__destroyed)
            return;
        const gate = (0, ai_1.checkAiGate)();
        this.setData({
            aiAllowed: gate.allowed,
            gateReason: gate.reason || '',
        });
    },
    render(scroll) {
        if (this.__destroyed)
            return;
        const patch = { messages: (0, indexLogic_1.buildMessageViews)(allMessages, errorIndex) };
        if (scroll && allMessages.length > 0)
            patch.scrollInto = `m${allMessages.length - 1}`;
        this.setData(patch);
    },
    persist() {
        if (allMessages.length === 0)
            return;
        (0, indexLogic_1.saveSession)({ id: sessionId, title: (0, indexLogic_1.sessionTitle)(allMessages), updatedAt: Date.now(), messages: allMessages.slice() });
    },
    // ============================== 上下文多选 ==============================
    onOpenPicker() {
        this.setData({ showPicker: true, articleOptions: this.buildOptions(this.data.selectedUuids) });
    },
    onToggleArticle(e) {
        const uuid = String(e.currentTarget.dataset.uuid);
        const options = this.data.articleOptions.map((o) => ({ ...o }));
        const target = options.find((o) => o.uuid === uuid);
        if (!target)
            return;
        const checkedCount = options.filter((o) => o.checked).length;
        if (!target.checked && checkedCount >= 3) {
            wx.showToast({ title: '最多选择 3 篇', icon: 'none' });
            return;
        }
        target.checked = !target.checked;
        target.cls = target.checked ? 'picker-check--on' : '';
        target.mark = target.checked ? '✓' : '';
        this.setData({ articleOptions: options });
    },
    onConfirmPicker() {
        const selected = this.data.articleOptions.filter((o) => o.checked).map((o) => o.uuid);
        this.setData({ selectedUuids: selected, ctxText: this.ctxTextOf(selected), showPicker: false });
    },
    onClosePicker() {
        this.setData({ showPicker: false });
    },
    // ============================== 发送 ==============================
    onInput(e) {
        this.setData({ inputValue: e.detail.value });
    },
    onSend() {
        if (this.data.sending)
            return;
        const text = (this.data.inputValue || '').trim();
        if (!text) {
            wx.showToast({ title: '请输入内容', icon: 'none' });
            return;
        }
        const gate = (0, ai_1.checkAiGate)();
        if (!gate.allowed) {
            this.setData({ aiAllowed: false, gateReason: gate.reason || '', lockVisible: true });
            return;
        }
        allMessages.push({ role: 'user', content: text });
        this.setData({ inputValue: '' });
        this.streamReply();
    },
    streamReply() {
        if (abortTask) {
            abortTask.abort();
            abortTask = null;
        }
        allMessages.push({ role: 'assistant', content: '' });
        errorIndex = -1;
        this.render(true);
        this.setData({ sending: true, sendText: '生成中', sendCls: 'btn btn--primary btn--sm tb-off' });
        const body = {
            sessionId,
            articleUuids: this.data.selectedUuids,
            messages: (0, indexLogic_1.toApiMessages)(allMessages),
        };
        abortTask = (0, ai_1.startChatStream)(body, {
            onChunk: (t) => {
                const last = allMessages[allMessages.length - 1];
                if (!last)
                    return;
                last.content += t;
                this.render(false);
            },
            onDone: () => {
                abortTask = null;
                if (this.__destroyed)
                    return;
                this.setData({ sending: false, sendText: '发送', sendCls: 'btn btn--primary btn--sm' });
                this.persist();
                this.render(false);
            },
            onError: (e) => {
                abortTask = null;
                if (this.__destroyed)
                    return;
                const last = allMessages[allMessages.length - 1];
                if (last) {
                    if (!last.content)
                        last.content = (0, ai_1.aiErrorText)(e);
                    errorIndex = allMessages.length - 1;
                }
                this.setData({ sending: false, sendText: '发送', sendCls: 'btn btn--primary btn--sm' });
                this.render(true);
            },
        });
    },
    onResend(e) {
        if (this.data.sending)
            return;
        const index = Number(e.currentTarget.dataset.index);
        if (index >= 0 && index < allMessages.length && allMessages[index].role === 'assistant') {
            allMessages.splice(index, 1);
            errorIndex = -1;
            this.render(false);
        }
        const gate = (0, ai_1.checkAiGate)();
        if (!gate.allowed) {
            this.setData({ aiAllowed: false, gateReason: gate.reason || '', lockVisible: true });
            return;
        }
        this.streamReply();
    },
    // ============================== 入口 / 锁定 ==============================
    onHistory() {
        wx.navigateTo({ url: '/packages/ai/pages/ai-history/index' });
    },
    onLockClose() {
        this.setData({ lockVisible: false });
    },
});
