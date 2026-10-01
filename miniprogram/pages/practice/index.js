"use strict";
/**
 * 练习页：三种模式作答 / 提示系统（10s 弱 + 5s 强）/ AI 采集与坐标生成 / 断点续练
 * 规则口径全部来自 core/practice/session.ts，此处只做编排与渲染。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
const prefs_1 = require("../../core/storage/prefs");
const entities_1 = require("../../core/storage/entities");
const section_1 = require("../../core/algorithms/section");
const session_1 = require("../../core/practice/session");
const view_1 = require("./view");
const lastResult_1 = require("../../core/practice/lastResult");
const ai_1 = require("../../core/ai");
const config_1 = require("../../core/config");
let session = null;
let judgedDetail = null;
let hintTimer = null;
let hintIdleMs = 0;
let weakShown = false;
let weakShownAt = 0;
let focusBlankIndex = null;
let aiAborted = false;
let pinchStart = 0;
let pinchStartScale = 1;
let hintBlankIndex = null;
let hintChar = '';
let offTheme = null;
/** 返回拦截（基础库差异，做安全调用） */
function setUnloadGuard(message) {
    const w = wx;
    try {
        if (message && w.enableAlertBeforeUnload)
            w.enableAlertBeforeUnload({ message });
        else if (w.disableAlertBeforeUnload)
            w.disableAlertBeforeUnload();
    }
    catch {
        /* 忽略 */
    }
}
const FONT_SCALES = [0.6, 1, 1.6, 2.2, 3];
const BASE_FONT_RPX = 40;
Page({
    data: {
        themeStyle: '',
        articleTitle: '',
        phase: 'setup',
        mode: 'SENTENCE',
        modeLabel: '句子挖空',
        segments: [],
        answered: 0,
        total: 0,
        progressPercent: 0,
        fontPx: BASE_FONT_RPX,
        fontScaleLabel: '1.0x',
        lineHeight: 1.9,
        clues: [],
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
            mode: 'SENTENCE',
            sectionMode: 'FULL',
            strategy: 'BALANCED',
            classical: false,
            useAi: false,
        },
        collect: { level: 2, strategy: 'BALANCED', extra: '' },
        sections: [],
        selectedSectionCount: 0,
        aiAvailable: false,
        /** 全文超过 AI 单次处理上限（其余部分由本地算法补齐挖空） */
        aiLongText: false,
        aiMaxChars: config_1.LIMITS.aiClozeMaxChars,
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
        crossIds: [],
        crossTitles: '',
    },
    onLoad(query) {
        const crossIds = (query.articleUuids || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const crossMode = crossIds.length > 1;
        const articleUuid = crossMode ? crossIds[0] : query.articleUuid || '';
        const article = entities_1.articleStore.find(articleUuid);
        if (!article) {
            wx.showToast({ title: '文章不存在', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 800);
            return;
        }
        const settings = (0, prefs_1.getSettings)();
        const mode = query.mode || 'SENTENCE';
        const crossArticles = crossMode
            ? crossIds.map((id) => entities_1.articleStore.find(id)).filter((a) => !!a)
            : [];
        this.setData({
            themeStyle: (0, theme_1.themeStyle)(),
            articleTitle: crossMode ? `跨文复习（${crossArticles.length} 篇）` : article.title,
            articleUuid,
            configUuid: crossMode ? '' : query.configUuid || '',
            resumeFlag: !crossMode && query.resume === '1',
            mode,
            modeLabel: view_1.MODE_LABEL[mode],
            option: { ...this.data.option, mode },
            lineHeight: settings.readingLineHeight || 1.9,
            fontPx: BASE_FONT_RPX,
            showHintHint: settings.showHint,
            crossMode,
            crossIds: crossMode ? crossIds : [],
            crossTitles: crossArticles.map((a) => a.title).join('、'),
        });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
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
        if (session && !this.data.graded && !this.data.crossMode && (0, session_1.answeredCount)(session) > 0) {
            (0, session_1.persistProgress)(session);
        }
        setUnloadGuard(null);
        session = null;
        judgedDetail = null;
    },
    // ============================== 准备与设置 ==============================
    prepareSections(content) {
        const sections = section_1.SectionSplitter.split(content);
        this.setData({
            sections: sections.map((s) => ({
                index: s.index,
                label: s.heading ? `${s.index + 1}. ${s.heading}` : `${s.index + 1}. ${s.contentOnly.slice(0, 20)}`,
                selected: false,
            })),
        });
    },
    refreshAiAvailability() {
        const settings = (0, prefs_1.getSettings)();
        const gate = (0, ai_1.checkAiGate)();
        // 设置中的「使用 AI 挖空」作为练习页默认值（与 Android 端一致：开启后默认走 AI）
        const enabled = !!settings.useAiCloze;
        const article = entities_1.articleStore.find(this.data.articleUuid);
        const longText = !!article && article.content.length > config_1.LIMITS.aiClozeMaxChars;
        this.setData({
            aiAvailable: enabled,
            option: { ...this.data.option, useAi: enabled },
            aiLongText: longText,
            gateReason: gate.reason || '',
        });
    },
    resumeExisting() {
        const restored = (0, session_1.restoreSession)(this.data.articleUuid);
        if (!restored) {
            wx.showToast({ title: '没有可恢复的进度', icon: 'none' });
            this.startLocal();
            return;
        }
        session = restored;
        this.setData({
            mode: restored.mode,
            modeLabel: view_1.MODE_LABEL[restored.mode],
            phase: 'answering',
            dictationInput: restored.dictationInput || '',
            clues: (0, view_1.dictationClues)(restored),
        });
        this.refreshView();
        this.startHintLoop();
    },
    onPickMode(e) {
        const value = e.currentTarget.dataset.value;
        this.setData({ 'option.mode': value, mode: value, modeLabel: view_1.MODE_LABEL[value] });
    },
    onPickSectionMode(e) {
        const value = e.currentTarget.dataset.value;
        this.setData({ 'option.sectionMode': value });
    },
    onToggleSection(e) {
        const index = Number(e.currentTarget.dataset.index);
        const sections = this.data.sections.map((s) => (s.index === index ? { ...s, selected: !s.selected } : s));
        this.setData({ sections, selectedSectionCount: sections.filter((s) => s.selected).length });
    },
    onPickStrategy(e) {
        const value = e.currentTarget.dataset.value;
        this.setData({ 'option.strategy': value });
    },
    onToggleClassical(e) {
        this.setData({ 'option.classical': e.detail.checked });
    },
    onToggleAi(e) {
        if (e.detail.checked) {
            const gate = (0, ai_1.checkAiGate)();
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
            const gate = (0, ai_1.checkAiGate)();
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
    onPickLevel(e) {
        this.setData({ 'collect.level': Number(e.currentTarget.dataset.value) });
    },
    onPickCollectStrategy(e) {
        this.setData({ 'collect.strategy': e.currentTarget.dataset.value });
    },
    onExtraInput(e) {
        this.setData({ 'collect.extra': e.detail.value });
    },
    onCancelCollect() {
        this.setData({ phase: 'setup' });
    },
    async onConfirmCollect() {
        const article = entities_1.articleStore.find(this.data.articleUuid);
        if (!article)
            return;
        aiAborted = false;
        this.setData({ phase: 'ai' });
        try {
            const res = await (0, ai_1.withTimeout)((0, ai_1.requestAiCloze)({
                articleText: article.content,
                mode: this.data.mode,
                strategy: this.data.collect.strategy,
                level: this.data.collect.level,
                extra: this.data.collect.extra,
            }), 40000, 'AI 响应超时');
            if (aiAborted)
                return;
            this.startLocal(res.coords);
        }
        catch (e) {
            if (aiAborted)
                return;
            wx.showToast({ title: `${(0, ai_1.aiErrorText)(e)}，已回退本地算法`, icon: 'none' });
            this.startLocal();
        }
    },
    onFallbackLocal() {
        aiAborted = true;
        wx.showToast({ title: '已切换为本地算法', icon: 'none' });
        this.startLocal();
    },
    // ============================== 会话启动 ==============================
    startLocal(aiCoords) {
        const { option, articleUuid, configUuid, crossMode } = this.data;
        const selected = this.data.sections.filter((s) => s.selected).map((s) => s.index);
        const { session: created, warning } = (0, session_1.startSession)({
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
            const ok = (0, session_1.applyAiCoords)(session, aiCoords);
            if (!ok)
                wx.showToast({ title: 'AI 坐标不可用，已用本地算法', icon: 'none' });
        }
        if (warning)
            wx.showToast({ title: warning, icon: 'none' });
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
            clues: session ? (0, view_1.dictationClues)(session) : [],
            mode: session ? session.mode : option.mode,
            modeLabel: session ? view_1.MODE_LABEL[session.mode] : this.data.modeLabel,
        });
        this.refreshView();
        this.startHintLoop();
    },
    // ============================== 视图同步 ==============================
    refreshView() {
        if (!session)
            return;
        const vm = (0, view_1.buildViewModel)(session, judgedDetail, this.data.showHintHint ? hintBlankIndex : null, hintChar);
        this.setData({
            segments: vm.segments,
            answered: vm.answered,
            total: vm.total,
            progressPercent: vm.progressPercent,
            modeLabel: vm.modeLabel,
            allAnswered: (0, session_1.isAllAnswered)(session),
            dictationInput: session.dictationInput || this.data.dictationInput,
        });
        this.updateUnloadGuard();
    },
    /** 只刷新输入值（避免整棵树重渲染导致光标跳动） */
    syncAnswerValues() {
        if (!session)
            return;
        const vm = (0, view_1.buildViewModel)(session, judgedDetail, this.data.showHintHint ? hintBlankIndex : null, hintChar);
        this.setData({
            segments: vm.segments,
            answered: vm.answered,
            progressPercent: vm.progressPercent,
            allAnswered: (0, session_1.isAllAnswered)(session),
        });
    },
    updateUnloadGuard() {
        if (!session)
            return;
        const settings = (0, prefs_1.getSettings)();
        const partial = (0, session_1.answeredCount)(session) > 0 && !(0, session_1.isAllAnswered)(session) && !this.data.graded && !this.data.crossMode;
        setUnloadGuard(partial && !settings.backWarningDisabled ? '退出后本次作答会作为断点保存' : null);
    },
    // ============================== 输入 ==============================
    onBlankInput(e) {
        if (!session)
            return;
        const index = Number(e.currentTarget.dataset.index);
        (0, session_1.setAnswer)(session, index, e.detail.value);
        this.resetHint();
        this.setData({ answered: (0, session_1.answeredCount)(session), allAnswered: (0, session_1.isAllAnswered)(session) });
    },
    onBlankFocus(e) {
        const index = Number(e.currentTarget.dataset.index);
        focusBlankIndex = index;
        if (session)
            session.focusBlankIndex = index;
        this.resetHint();
    },
    onBlankBlur(e) {
        if (!session)
            return;
        const index = Number(e.currentTarget.dataset.index);
        (0, session_1.setAnswer)(session, index, e.detail.value);
        this.syncAnswerValues();
    },
    onDictationInput(e) {
        if (!session)
            return;
        (0, session_1.setDictationInput)(session, e.detail.value);
        this.resetHint();
        this.setData({ answered: (0, session_1.answeredCount)(session), allAnswered: (0, session_1.isAllAnswered)(session) });
    },
    onDictationFocus() {
        focusBlankIndex = null;
        this.resetHint();
    },
    onCopyClue(e) {
        const text = e.currentTarget.dataset.text;
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
        const settings = (0, prefs_1.getSettings)();
        if (!session || this.data.phase !== 'answering' || !settings.showHint)
            return;
        hintIdleMs += 500;
        if (!weakShown) {
            if (hintIdleMs >= 10000) {
                const hint = (0, session_1.nextHint)(session, focusBlankIndex);
                if (hint) {
                    hintBlankIndex = hint.blankIndex;
                    hintChar = hint.char;
                    weakShown = true;
                    weakShownAt = Date.now();
                    (0, session_1.countWeakHint)(session);
                    this.syncAnswerValues();
                }
            }
            return;
        }
        if (Date.now() - weakShownAt >= 5000) {
            const applied = (0, session_1.applyStrongHint)(session, focusBlankIndex);
            if (applied) {
                (0, session_1.countStrongHint)(session);
                // 继续淡显下一个字
                const next = (0, session_1.nextHint)(session, applied.blankIndex === null ? null : applied.blankIndex);
                if (next) {
                    hintBlankIndex = next.blankIndex;
                    hintChar = next.char;
                    weakShownAt = Date.now();
                    (0, session_1.countWeakHint)(session);
                }
                else {
                    hintBlankIndex = null;
                    hintChar = '';
                    weakShown = false;
                }
                hintIdleMs = 0;
                this.syncAnswerValues();
            }
            else {
                hintBlankIndex = null;
                hintChar = '';
                weakShown = false;
                this.syncAnswerValues();
            }
        }
    },
    // ============================== 字号缩放（双指） ==============================
    onTouchStart(e) {
        if (e.touches.length === 2) {
            pinchStart = distance(e.touches);
            pinchStartScale = this.data.fontPx / BASE_FONT_RPX;
        }
    },
    onTouchMove(e) {
        if (e.touches.length !== 2 || pinchStart <= 0)
            return;
        const ratio = distance(e.touches) / pinchStart;
        const scale = clamp(pinchStartScale * ratio, FONT_SCALES[0], FONT_SCALES[FONT_SCALES.length - 1]);
        this.applyFontScale(scale);
    },
    onToggleFont() {
        const current = this.data.fontPx / BASE_FONT_RPX;
        const next = FONT_SCALES.find((s) => s > current + 0.01) || FONT_SCALES[0];
        this.applyFontScale(next);
    },
    applyFontScale(scale) {
        this.setData({ fontPx: Math.round(BASE_FONT_RPX * scale), fontScaleLabel: `${scale.toFixed(1)}x` });
    },
    // ============================== 提交与批改 ==============================
    onGrade() {
        this.gradeImpl(false);
    },
    onPartialSubmit() {
        this.gradeImpl(true);
    },
    gradeImpl(partial) {
        if (!session)
            return;
        if (!partial && !(0, session_1.isAllAnswered)(session)) {
            wx.showModal({
                title: '还有未填写的空',
                content: '可以「批改已填写」保留断点，或继续作答',
                showCancel: false,
            });
            return;
        }
        const judge = (0, session_1.judgeSession)(session);
        judgedDetail = judge.perBlank;
        this.stopHintLoop();
        this.setData({ graded: true, correctCount: judge.correctCount, total: judge.totalBlanks });
        const isPartial = partial || !(0, session_1.isAllAnswered)(session);
        const record = (0, session_1.commitSession)(session, judge);
        if (isPartial && !this.data.crossMode)
            (0, session_1.persistProgress)(session);
        (0, lastResult_1.setLastResult)({
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
                const modes = ['SENTENCE', 'WORD', 'REVERSE'];
                const mode = modes[res.tapIndex];
                this.setData({ 'option.mode': mode, mode, modeLabel: view_1.MODE_LABEL[mode] });
                if (this.data.option.useAi)
                    this.setData({ phase: 'collect' });
                else
                    this.startLocal();
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
function distance(touches) {
    const a = touches[0];
    const b = touches[1];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}
/** 跨文复习内容：按文章顺序拼接（空行分隔），标题行一并保留 */
function combineContent(ids) {
    const parts = [];
    for (const id of ids) {
        const article = entities_1.articleStore.find(id);
        if (!article)
            continue;
        parts.push(article.content.trim());
    }
    return parts.join('\n\n');
}
