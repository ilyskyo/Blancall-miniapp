/**
 * 练习页：三种模式作答 / 提示系统（10s 弱 + 5s 强）/ AI 采集与坐标生成 / 断点续练
 * 规则口径全部来自 core/practice/session.ts，此处只做编排与渲染。
 */

import { themeStyle, onThemeChange } from '../../core/theme/theme';
import { getSettings } from '../../core/storage/prefs';
import { articleStore } from '../../core/storage/entities';
import { SectionSplitter } from '../../core/algorithms/section';
import { ClozeStrategy, PracticeMode, SectionMode } from '../../core/algorithms/types';
import {
  PracticeSession,
  applyAiCoords,
  applyStrongHint,
  answeredCount,
  commitSession,
  countStrongHint,
  countWeakHint,
  isAllAnswered,
  judgeSession,
  nextHint,
  persistProgress,
  restoreSession,
  setAnswer,
  setDictationInput,
  startSession,
} from '../../core/practice/session';
import { buildViewModel, dictationClues, MODE_LABEL, SegmentView } from './view';
import { setLastResult } from '../../core/practice/lastResult';
import { aiErrorText, checkAiGate, requestAiCloze, withTimeout } from '../../core/ai';
import { requireLogin } from '../../core/net/auth';
import { LIMITS } from '../../core/config';

let session: PracticeSession | null = null;
let judgedDetail: Record<number, { result: string }> | null = null;
let hintTimer: ReturnType<typeof setInterval> | null = null;
let hintIdleMs = 0;
let weakShown = false;
let weakShownAt = 0;
let focusBlankIndex: number | null = null;
let aiAborted = false;
let pinchStart = 0;
let pinchStartScale = 1;
let hintBlankIndex: number | null = null;
let hintChar = '';
let offTheme: (() => void) | null = null;

/** 返回拦截（基础库差异，做安全调用） */
function setUnloadGuard(message: string | null): void {
  const w = wx as unknown as {
    enableAlertBeforeUnload?: (opt: { message: string }) => void;
    disableAlertBeforeUnload?: () => void;
  };
  try {
    if (message && w.enableAlertBeforeUnload) w.enableAlertBeforeUnload({ message });
    else if (w.disableAlertBeforeUnload) w.disableAlertBeforeUnload();
  } catch {
    /* 忽略 */
  }
}

const FONT_SCALES = [0.6, 1, 1.6, 2.2, 3];
const BASE_FONT_RPX = 40;

Page({
  data: {
    themeStyle: '',
    articleTitle: '',
    phase: 'setup' as 'setup' | 'collect' | 'ai' | 'answering',
    mode: 'SENTENCE' as PracticeMode,
    modeLabel: '句子挖空',
    segments: [] as SegmentView[],
    answered: 0,
    total: 0,
    progressPercent: 0,
    fontPx: BASE_FONT_RPX,
    fontScaleLabel: '1.0x',
    lineHeight: 1.9,
    clues: [] as Array<{ displayOrder: number; text: string }>,
    dictationInput: '',
    modeOptions: [
      { value: 'SENTENCE', label: '句子挖空', desc: '分句/半句/复句', icon: '📝' },
      { value: 'WORD', label: '字词挖空', desc: '1–3 字词', icon: '🔤' },
      { value: 'REVERSE', label: '反向默写', desc: '整段默写', icon: '✍️' },
    ],
    sectionModes: [
      { value: 'FULL', label: '全文' },
      { value: 'WEAKNESS', label: '薄弱集训' },
      { value: 'SELECTED', label: '自选' },
    ],
    strategies: [
      { value: 'BALANCED', label: '均衡' },
      { value: 'WEAKNESS_FOCUS', label: '薄弱优先' },
      { value: 'FULL_COVERAGE', label: '全覆盖' },
    ],
    levels: [
      { value: 1, label: '简单' },
      { value: 2, label: '正常' },
      { value: 3, label: '较难' },
    ],
    option: {
      mode: 'SENTENCE' as PracticeMode,
      sectionMode: 'FULL' as SectionMode,
      strategy: 'BALANCED' as ClozeStrategy,
      classical: false,
      useAi: false,
    },
    collect: { level: 2, strategy: 'BALANCED' as ClozeStrategy, extra: '' },
    sections: [] as Array<{ index: number; label: string; selected: boolean }>,
    selectedSectionCount: 0,
    aiAvailable: false,
    /** 全文超过 AI 单次处理上限（其余部分由本地算法补齐挖空） */
    aiLongText: false,
    aiMaxChars: LIMITS.aiClozeMaxChars,
    aiCampaignFree: false,
    showHintHint: true,
    allAnswered: false,
    graded: false,
    correctCount: 0,
    articleUuid: '',
    configUuid: '',
    resumeFlag: false,
    /** 跨文复习：多篇混编（不落断点、不用自定义挖空配置） */
    crossMode: false,
    crossIds: [] as string[],
    crossTitles: '',
  },

  onLoad(query: Record<string, string>) {
    const crossIds = (query.articleUuids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const crossMode = crossIds.length > 1;
    const articleUuid = crossMode ? crossIds[0] : query.articleUuid || '';
    const article = articleStore.find(articleUuid);
    if (!article) {
      wx.showToast({ title: '文章不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const settings = getSettings();
    const mode = (query.mode as PracticeMode) || 'SENTENCE';
    const crossArticles = crossMode
      ? crossIds.map((id) => articleStore.find(id)).filter((a): a is NonNullable<typeof a> => !!a)
      : [];
    this.setData({
      themeStyle: themeStyle(),
      articleTitle: crossMode ? `跨文复习（${crossArticles.length} 篇）` : article.title,
      articleUuid,
      configUuid: crossMode ? '' : query.configUuid || '',
      resumeFlag: !crossMode && query.resume === '1',
      mode,
      modeLabel: MODE_LABEL[mode],
      option: { ...this.data.option, mode },
      lineHeight: settings.readingLineHeight || 1.9,
      fontPx: BASE_FONT_RPX,
      showHintHint: settings.showHint,
      crossMode,
      crossIds: crossMode ? crossIds : [],
      crossTitles: crossArticles.map((a) => a.title).join('、'),
    });
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));

    const contentForSections = crossMode ? combineContent(crossIds) : article.content;
    this.prepareSections(contentForSections);
    this.refreshAiAvailability();

    if (!crossMode && query.resume === '1') {
      this.resumeExisting();
    }
  },

  onUnload() {
    aiAborted = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
    this.stopHintLoop();
    // 未批改且已作答 → 保留断点（跨文复习不落盘，与 Android 端一致）
    if (session && !this.data.graded && !this.data.crossMode && answeredCount(session) > 0) {
      persistProgress(session);
    }
    setUnloadGuard(null);
    session = null;
    judgedDetail = null;
  },

  // ============================== 准备与设置 ==============================

  prepareSections(content: string) {
    const sections = SectionSplitter.split(content);
    this.setData({
      sections: sections.map((s) => ({
        index: s.index,
        label: s.heading ? `${s.index + 1}. ${s.heading}` : `${s.index + 1}. ${s.contentOnly.slice(0, 20)}`,
        selected: false,
      })),
    });
  },

  refreshAiAvailability() {
    const settings = getSettings();
    const gate = checkAiGate();
    // 设置中的「使用 AI 挖空」作为练习页默认值（与 Android 端一致：开启后默认走 AI）
    const enabled = !!settings.useAiCloze;
    const article = articleStore.find(this.data.articleUuid);
    const longText = !!article && article.content.length > LIMITS.aiClozeMaxChars;
    this.setData({
      aiAvailable: enabled,
      option: { ...this.data.option, useAi: enabled },
      aiLongText: longText,
      gateReason: gate.reason || '',
    });
  },

  resumeExisting() {
    const restored = restoreSession(this.data.articleUuid);
    if (!restored) {
      wx.showToast({ title: '没有可恢复的进度', icon: 'none' });
      this.startLocal();
      return;
    }
    session = restored;
    this.setData({
      mode: restored.mode,
      modeLabel: MODE_LABEL[restored.mode],
      phase: 'answering',
      dictationInput: restored.dictationInput || '',
      clues: dictationClues(restored),
    });
    this.refreshView();
    this.startHintLoop();
  },

  onPickMode(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value as PracticeMode;
    this.setData({ 'option.mode': value, mode: value, modeLabel: MODE_LABEL[value] });
  },

  onPickSectionMode(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value as SectionMode;
    this.setData({ 'option.sectionMode': value });
  },

  onToggleSection(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const sections = this.data.sections.map((s) => (s.index === index ? { ...s, selected: !s.selected } : s));
    this.setData({ sections, selectedSectionCount: sections.filter((s) => s.selected).length });
  },

  onPickStrategy(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value as ClozeStrategy;
    this.setData({ 'option.strategy': value });
  },

  onToggleClassical(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.setData({ 'option.classical': e.detail.checked });
  },

  onToggleAi(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    if (e.detail.checked) {
      const gate = checkAiGate();
      if (!gate.allowed) {
        wx.showToast({ title: gate.reason || 'AI 不可用', icon: 'none' });
        this.setData({ 'option.useAi': false });
        return;
      }
    }
    this.setData({ 'option.useAi': e.detail.checked });
  },

  onCancelSetup() {
    wx.navigateBack();
  },

  onOpenModeSheet() {
    this.setData({ phase: 'setup' });
  },

  onConfirmSetup() {
    const { option } = this.data;
    if (option.sectionMode === 'SELECTED' && this.data.selectedSectionCount === 0) {
      wx.showToast({ title: '请至少选择 1 段', icon: 'none' });
      return;
    }
    if (option.useAi) {
      const gate = checkAiGate();
      if (!gate.allowed) {
        wx.showModal({
          title: 'AI 功能未上线',
          content: gate.reason || '',
          confirmText: '用本地算法',
          showCancel: false,
          success: () => this.startLocal(),
        });
        return;
      }
      this.setData({ phase: 'collect' });
      return;
    }
    this.startLocal();
  },

  // ============================== AI 采集 ==============================

  onPickLevel(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'collect.level': Number(e.currentTarget.dataset.value) });
  },

  onPickCollectStrategy(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'collect.strategy': e.currentTarget.dataset.value as ClozeStrategy });
  },

  onExtraInput(e: WechatMiniprogram.Input) {
    this.setData({ 'collect.extra': e.detail.value });
  },

  onCancelCollect() {
    this.setData({ phase: 'setup' });
  },

  async onConfirmCollect() {
    const article = articleStore.find(this.data.articleUuid);
    if (!article) return;
    aiAborted = false;
    this.setData({ phase: 'ai' });
    try {
      const res = await withTimeout(
        requestAiCloze({
          articleText: article.content,
          mode: this.data.mode,
          strategy: this.data.collect.strategy,
          level: this.data.collect.level,
          extra: this.data.collect.extra,
        }),
        40000,
        'AI 响应超时'
      );
      if (aiAborted) return;
      this.startLocal(res.coords);
    } catch (e) {
      if (aiAborted) return;
      wx.showToast({ title: `${aiErrorText(e)}，已回退本地算法`, icon: 'none' });
      this.startLocal();
    }
  },

  onFallbackLocal() {
    aiAborted = true;
    wx.showToast({ title: '已切换为本地算法', icon: 'none' });
    this.startLocal();
  },

  // ============================== 会话启动 ==============================

  startLocal(aiCoords?: number[] | Array<{ sentence: number; start: number; end: number }>) {
    const { option, articleUuid, configUuid, crossMode } = this.data;
    const selected = this.data.sections.filter((s) => s.selected).map((s) => s.index);
    const { session: created, warning } = startSession({
      articleUuid,
      mode: option.mode,
      strategy: option.strategy,
      sectionMode: option.sectionMode,
      selectedSections: selected,
      classicalMode: option.classical,
      configUuid: crossMode ? '' : configUuid,
      contentOverride: crossMode ? combineContent(this.data.crossIds) : undefined,
    });
    session = created;
    judgedDetail = null;
    if (aiCoords && session) {
      const ok = applyAiCoords(session, aiCoords);
      if (!ok) wx.showToast({ title: 'AI 坐标不可用，已用本地算法', icon: 'none' });
    }
    if (warning) wx.showToast({ title: warning, icon: 'none' });
    if (!session || (session.blanks.length === 0 && session.mode !== 'REVERSE')) {
      wx.showModal({
        title: '无法生成挖空',
        content: '当前内容或段落范围过短，请更换范围或模式',
        showCancel: false,
        success: () => this.setData({ phase: 'setup' }),
      });
      return;
    }
    this.setData({
      phase: 'answering',
      graded: false,
      dictationInput: '',
      clues: session ? dictationClues(session) : [],
      mode: session ? session.mode : option.mode,
      modeLabel: session ? MODE_LABEL[session.mode] : this.data.modeLabel,
    });
    this.refreshView();
    this.startHintLoop();
  },

  // ============================== 视图同步 ==============================

  refreshView() {
    if (!session) return;
    const vm = buildViewModel(session, judgedDetail, this.data.showHintHint ? hintBlankIndex : null, hintChar);
    this.setData({
      segments: vm.segments,
      answered: vm.answered,
      total: vm.total,
      progressPercent: vm.progressPercent,
      modeLabel: vm.modeLabel,
      allAnswered: isAllAnswered(session),
      dictationInput: session.dictationInput || this.data.dictationInput,
    });
    this.updateUnloadGuard();
  },

  /** 只刷新输入值（避免整棵树重渲染导致光标跳动） */
  syncAnswerValues() {
    if (!session) return;
    const vm = buildViewModel(session, judgedDetail, this.data.showHintHint ? hintBlankIndex : null, hintChar);
    this.setData({
      segments: vm.segments,
      answered: vm.answered,
      progressPercent: vm.progressPercent,
      allAnswered: isAllAnswered(session),
    });
  },

  updateUnloadGuard() {
    if (!session) return;
    const settings = getSettings();
    const partial = answeredCount(session) > 0 && !isAllAnswered(session) && !this.data.graded && !this.data.crossMode;
    setUnloadGuard(partial && !settings.backWarningDisabled ? '退出后本次作答会作为断点保存' : null);
  },

  // ============================== 输入 ==============================

  onBlankInput(e: WechatMiniprogram.Input) {
    if (!session) return;
    const index = Number(e.currentTarget.dataset.index);
    setAnswer(session, index, e.detail.value);
    this.resetHint();
    this.setData({ answered: answeredCount(session), allAnswered: isAllAnswered(session) });
  },

  onBlankFocus(e: WechatMiniprogram.CustomEvent) {
    const index = Number(e.currentTarget.dataset.index);
    focusBlankIndex = index;
    if (session) session.focusBlankIndex = index;
    this.resetHint();
  },

  onBlankBlur(e: WechatMiniprogram.Input) {
    if (!session) return;
    const index = Number(e.currentTarget.dataset.index);
    setAnswer(session, index, e.detail.value);
    this.syncAnswerValues();
  },

  onDictationInput(e: WechatMiniprogram.Input) {
    if (!session) return;
    setDictationInput(session, e.detail.value);
    this.resetHint();
    this.setData({ answered: answeredCount(session), allAnswered: isAllAnswered(session) });
  },

  onDictationFocus() {
    focusBlankIndex = null;
    this.resetHint();
  },

  onCopyClue(e: WechatMiniprogram.TouchEvent) {
    const text = e.currentTarget.dataset.text as string;
    wx.setClipboardData({ data: text.replace(/___/g, '____') });
  },

  // ============================== 提示系统（10s / 5s / 5s） ==============================

  startHintLoop() {
    this.stopHintLoop();
    hintIdleMs = 0;
    weakShown = false;
    weakShownAt = 0;
    hintTimer = setInterval(() => this.hintTick(), 500);
  },

  stopHintLoop() {
    if (hintTimer) {
      clearInterval(hintTimer);
      hintTimer = null;
    }
  },

  resetHint() {
    hintIdleMs = 0;
    weakShown = false;
    weakShownAt = 0;
    hintBlankIndex = null;
    hintChar = '';
    this.syncAnswerValues();
  },

  hintTick() {
    const settings = getSettings();
    if (!session || this.data.phase !== 'answering' || !settings.showHint) return;
    hintIdleMs += 500;

    if (!weakShown) {
      if (hintIdleMs >= 10000) {
        const hint = nextHint(session, focusBlankIndex);
        if (hint) {
          hintBlankIndex = hint.blankIndex;
          hintChar = hint.char;
          weakShown = true;
          weakShownAt = Date.now();
          countWeakHint(session);
          this.syncAnswerValues();
        }
      }
      return;
    }

    if (Date.now() - weakShownAt >= 5000) {
      const applied = applyStrongHint(session, focusBlankIndex);
      if (applied) {
        countStrongHint(session);
        // 继续淡显下一个字
        const next = nextHint(session, applied.blankIndex === null ? null : applied.blankIndex);
        if (next) {
          hintBlankIndex = next.blankIndex;
          hintChar = next.char;
          weakShownAt = Date.now();
          countWeakHint(session);
        } else {
          hintBlankIndex = null;
          hintChar = '';
          weakShown = false;
        }
        hintIdleMs = 0;
        this.syncAnswerValues();
      } else {
        hintBlankIndex = null;
        hintChar = '';
        weakShown = false;
        this.syncAnswerValues();
      }
    }
  },

  // ============================== 字号缩放（双指） ==============================

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    if (e.touches.length === 2) {
      pinchStart = distance(e.touches);
      pinchStartScale = this.data.fontPx / BASE_FONT_RPX;
    }
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    if (e.touches.length !== 2 || pinchStart <= 0) return;
    const ratio = distance(e.touches) / pinchStart;
    const scale = clamp(pinchStartScale * ratio, FONT_SCALES[0], FONT_SCALES[FONT_SCALES.length - 1]);
    this.applyFontScale(scale);
  },

  onToggleFont() {
    const current = this.data.fontPx / BASE_FONT_RPX;
    const next = FONT_SCALES.find((s) => s > current + 0.01) || FONT_SCALES[0];
    this.applyFontScale(next);
  },

  applyFontScale(scale: number) {
    this.setData({ fontPx: Math.round(BASE_FONT_RPX * scale), fontScaleLabel: `${scale.toFixed(1)}x` });
  },

  // ============================== 提交与批改 ==============================

  onGrade() {
    this.gradeImpl(false);
  },

  onPartialSubmit() {
    this.gradeImpl(true);
  },

  gradeImpl(partial: boolean) {
    if (!session) return;
    if (!partial && !isAllAnswered(session)) {
      wx.showModal({
        title: '还有未填写的空',
        content: '可以「批改已填写」保留断点，或继续作答',
        showCancel: false,
      });
      return;
    }
    const judge = judgeSession(session);
    judgedDetail = judge.perBlank;
    this.stopHintLoop();
    this.setData({ graded: true, correctCount: judge.correctCount, total: judge.totalBlanks });
    const isPartial = partial || !isAllAnswered(session);
    const record = commitSession(session, judge);
    if (isPartial && !this.data.crossMode) persistProgress(session);
    setLastResult({
      recordUuid: record.uuid,
      judgment: judge,
      session,
      articleTitle: this.data.articleTitle,
      partial: isPartial,
    });
    this.syncAnswerValues();
    setUnloadGuard(null);
    wx.navigateTo({ url: '/pages/result/index' });
  },

  onGoResult() {
    wx.navigateTo({ url: '/pages/result/index' });
  },

  onSwitchMode() {
    wx.showActionSheet({
      itemList: ['句子挖空', '字词挖空', '反向默写'],
      success: (res) => {
        const modes: PracticeMode[] = ['SENTENCE', 'WORD', 'REVERSE'];
        const mode = modes[res.tapIndex];
        this.setData({ 'option.mode': mode, mode, modeLabel: MODE_LABEL[mode] });
        if (this.data.option.useAi) this.setData({ phase: 'collect' });
        else this.startLocal();
      },
    });
  },

  onLockClose() {
    /* 由 lock-mask 内部处理跳转 */
  },

  noop() {
    /* 阻断遮罩点击 */
  },
});

// ============================== 模块级辅助 ==============================

function distance(touches: WechatMiniprogram.TouchEvent['touches']): number {
  const a = touches[0];
  const b = touches[1];
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 跨文复习内容：按文章顺序拼接（空行分隔），标题行一并保留 */
function combineContent(ids: string[]): string {
  const parts: string[] = [];
  for (const id of ids) {
    const article = articleStore.find(id);
    if (!article) continue;
    parts.push(article.content.trim());
  }
  return parts.join('\n\n');
}