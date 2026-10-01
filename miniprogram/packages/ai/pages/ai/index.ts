/**
 * AI 对话：多篇上下文问答（最多 3 篇）、流式输出、AI 生成标识、额度门控、本地会话落库
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { articleStore } from '../../../../core/storage/entities';
import { checkAiGate, startChatStream, aiErrorText } from '../../../../core/ai';
import { loadEntitlements } from '../../../../core/net/auth';
import { isLoggedIn } from '../../../../core/storage/prefs';
import { uuidv7 } from '../../../../core/utils/uuid';
import { AiMessage, MessageView, buildMessageViews, loadSession, saveSession, sessionTitle, toApiMessages } from './indexLogic';

let offTheme: (() => void) | null = null;
let sessionId = '';
let allMessages: AiMessage[] = [];
let errorIndex = -1;
let abortTask: { abort: () => void } | null = null;

interface ArticleOption {
  uuid: string;
  title: string;
  checked: boolean;
  cls: string;
  mark: string;
}

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    messages: [] as MessageView[],
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
    articleOptions: [] as ArticleOption[],
    selectedUuids: [] as string[],
  },

  async onLoad(query: Record<string, string>) {
    this.__destroyed = false;
    sessionId = query.sessionId || uuidv7();
    allMessages = [];
    errorIndex = -1;
    this.setData({ themeStyle: themeStyle(), messages: [] });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));

    // 上下文：ids 参数优先，否则默认最近一篇
    const articles = this.sortedArticles();
    const idsParam = (query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => !!s && articles.some((a) => a.uuid === s))
      .slice(0, 3);
    const selected = idsParam.length > 0 ? idsParam : articles.length > 0 ? [articles[0].uuid] : [];
    this.setData({ selectedUuids: selected, articleOptions: this.buildOptions(selected), ctxText: this.ctxTextOf(selected) });

    if (query.sessionId) await this.loadExisting(query.sessionId);

    this.refreshGate();
    if (isLoggedIn()) {
      void loadEntitlements()
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
    return articleStore.list().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  buildOptions(selected: string[]): ArticleOption[] {
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

  ctxTextOf(selected: string[]): string {
    if (selected.length === 0) return '未选择';
    const titles = selected.map((uuid) => {
      const a = articleStore.find(uuid);
      return a ? a.title : '已删除文章';
    });
    return titles.join('、');
  },

  /** 载入历史会话（AI 未上线：仅本地会话，无服务端存储） */
  async loadExisting(id: string) {
    const local = loadSession(id);
    if (local) {
      allMessages = local.messages.slice();
      this.render(true);
    }
  },

  refreshGate() {
    if (this.__destroyed) return;
    const gate = checkAiGate();
    this.setData({
      aiAllowed: gate.allowed,
      gateReason: gate.reason || '',
    });
  },

  render(scroll: boolean) {
    if (this.__destroyed) return;
    const patch: Record<string, unknown> = { messages: buildMessageViews(allMessages, errorIndex) };
    if (scroll && allMessages.length > 0) patch.scrollInto = `m${allMessages.length - 1}`;
    this.setData(patch);
  },

  persist() {
    if (allMessages.length === 0) return;
    saveSession({ id: sessionId, title: sessionTitle(allMessages), updatedAt: Date.now(), messages: allMessages.slice() });
  },

  // ============================== 上下文多选 ==============================

  onOpenPicker() {
    this.setData({ showPicker: true, articleOptions: this.buildOptions(this.data.selectedUuids) });
  },

  onToggleArticle(e: WechatMiniprogram.TouchEvent) {
    const uuid = String(e.currentTarget.dataset.uuid);
    const options = this.data.articleOptions.map((o) => ({ ...o }));
    const target = options.find((o) => o.uuid === uuid);
    if (!target) return;
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

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value });
  },

  onSend() {
    if (this.data.sending) return;
    const text = (this.data.inputValue || '').trim();
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    const gate = checkAiGate();
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
      messages: toApiMessages(allMessages),
    };
    abortTask = startChatStream(body, {
      onChunk: (t: string) => {
        const last = allMessages[allMessages.length - 1];
        if (!last) return;
        last.content += t;
        this.render(false);
      },
      onDone: () => {
        abortTask = null;
        if (this.__destroyed) return;
        this.setData({ sending: false, sendText: '发送', sendCls: 'btn btn--primary btn--sm' });
        this.persist();
        this.render(false);
      },
      onError: (e: Error) => {
        abortTask = null;
        if (this.__destroyed) return;
        const last = allMessages[allMessages.length - 1];
        if (last) {
          if (!last.content) last.content = aiErrorText(e);
          errorIndex = allMessages.length - 1;
        }
        this.setData({ sending: false, sendText: '发送', sendCls: 'btn btn--primary btn--sm' });
        this.render(true);
      },
    });
  },

  onResend(e: WechatMiniprogram.TouchEvent) {
    if (this.data.sending) return;
    const index = Number(e.currentTarget.dataset.index);
    if (index >= 0 && index < allMessages.length && allMessages[index].role === 'assistant') {
      allMessages.splice(index, 1);
      errorIndex = -1;
      this.render(false);
    }
    const gate = checkAiGate();
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