"use strict";
/**
 * 首页：搜索栏 + 品牌栏（下拉展开）+ 卡片画布（10 类卡片，可添加/固定/删除）
 * 卡片数据在每次 onShow 与下拉刷新时重新计算；布局持久化到 home_layout。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
const prefs_1 = require("../../core/storage/prefs");
const entities_1 = require("../../core/storage/entities");
const overview_1 = require("../../core/stats/overview");
const session_1 = require("../../core/practice/session");
const sentenceSelector_1 = require("../../core/algorithms/sentenceSelector");
const date_1 = require("../../core/utils/date");
const bus_1 = require("../../core/store/bus");
const homeLogic_1 = require("./homeLogic");
/** 当前布局卡片（供点击/长按回调查表，避免重复序列化） */
let currentCards = [];
let offTheme = null;
let brandStartY = 0;
/** 单次手势只触发一次展开/收起，避免 touchmove 反复触发导致抖动 */
let brandAxisLocked = false;
/** 本次运行是否已检查过首启引导（避免 onShow 反复触发） */
let onboardingChecked = false;
/** tabBar 页选中态（getTabBar 未在 Page 类型中声明，做安全调用） */
function syncTabBar(page, selected) {
    var _a, _b;
    const tb = (_b = (_a = page).getTabBar) === null || _b === void 0 ? void 0 : _b.call(_a);
    if (tb)
        tb.setData({ selected });
}
Page({
    data: {
        themeStyle: '',
        brandTitle: 'Blancall',
        brandSubtitle: '',
        brandExpanded: false,
        articleCount: 0,
        cards: [],
        sheetVisible: false,
        addable: [],
    },
    onLoad() {
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        (0, bus_1.bindPageEvents)(this, {
            [bus_1.EVT.homeLayoutChanged]: () => this.refresh(),
            [bus_1.EVT.articlesChanged]: () => this.refresh(),
            [bus_1.EVT.recordsChanged]: () => this.refresh(),
        });
        this.refresh();
    },
    onShow() {
        syncTabBar(this, 0);
        this.refresh();
        this.maybeShowOnboarding();
    },
    /**
     * 首次进入自动展示引导（原产品行为：首启显示 5 步引导，完成后不再出现）
     * 仅在首页首次 onShow 触发一次，且用户未看过引导时；用户主动返回不重复弹。
     */
    maybeShowOnboarding() {
        if (onboardingChecked || (0, prefs_1.getSettings)().onboardingSeen)
            return;
        onboardingChecked = true;
        wx.navigateTo({ url: '/pages/onboarding/index' });
    },
    onUnload() {
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
        (0, bus_1.unbindPageEvents)(this);
    },
    onPullDownRefresh() {
        this.refresh();
        wx.stopPullDownRefresh();
    },
    // ---------------- 数据计算 ----------------
    /** 重新计算全部卡片数据（每次 onShow / 下拉刷新 / 布局变更） */
    refresh() {
        let layout = (0, entities_1.getHomeLayout)();
        if (!layout.cards || layout.cards.length === 0) {
            const cards = (0, homeLogic_1.defaultHomeCards)();
            (0, entities_1.saveHomeLayout)(cards);
            layout = { uuid: layout.uuid, cards, updatedAt: Date.now() };
        }
        const cards = (0, homeLogic_1.sortCards)(layout.cards);
        currentCards = layout.cards;
        const articles = entities_1.articleStore.list();
        // 批量取数：一次构建索引，避免在循环里对每篇文章重复全量扫描（性能缺陷修复）
        const clozeBuckets = (0, entities_1.clozesByArticle)();
        const maskBuckets = (0, entities_1.masksByArticle)();
        const statBuckets = (0, entities_1.statsByArticle)();
        const clozeCounts = {};
        const maskCounts = {};
        const statsMap = {};
        for (const a of articles) {
            clozeCounts[a.uuid] = (clozeBuckets.get(a.uuid) || []).length;
            maskCounts[a.uuid] = (maskBuckets.get(a.uuid) || []).length;
            const s = statBuckets.get(a.uuid);
            statsMap[a.uuid] = {
                accuracy: s && s.totalBlanks > 0 ? s.correctCount / s.totalBlanks : 0,
                count: s ? s.count : 0,
                bestAccuracy: s ? s.bestAccuracy : 0,
            };
        }
        const inputs = {
            articles,
            due: (0, overview_1.dueSoon)(5),
            inProgress: (0, session_1.listInProgress)(),
            globalStats: (0, overview_1.globalStats)(),
            articleStats: statsMap,
            clozeCounts,
            maskCounts,
            sentence: this.ensureSentence(articles),
            hasClozeCustom: true,
            hasOcclusionCustom: true,
        };
        const settings = (0, prefs_1.getSettings)();
        this.setData({
            articleCount: articles.length,
            cards: cards.map((c) => (0, homeLogic_1.buildCardView)(c, inputs)),
            addable: (0, homeLogic_1.addableOptions)(layout.cards, articles.length > 0),
            brandSubtitle: settings.subtitle || '日拱一卒，功不唐捐',
        });
    },
    /** 每日一句：当天已生成则复用，否则按 SentenceSelector 抽新句并落盘 */
    ensureSentence(articles) {
        const today = (0, date_1.dateKey)();
        const cached = (0, entities_1.getSentenceCard)(today);
        if (cached)
            return cached;
        if (articles.length === 0)
            return null;
        const states = new Map();
        for (const s of (0, entities_1.allFsrs)())
            states.set(s.key, s);
        const pick = sentenceSelector_1.SentenceSelector.pickNew(articles, states);
        if (!pick)
            return null;
        const article = entities_1.articleStore.find(pick.articleId);
        const card = {
            date: today,
            key: pick.key,
            articleUuid: pick.articleId,
            text: pick.text,
            start: pick.start,
            end: pick.end,
            title: article ? article.title : '',
        };
        try {
            (0, entities_1.saveSentenceCard)(card);
        }
        catch (e) {
            console.warn('[home] 句卡保存失败', e);
        }
        return { uuid: 'today', updatedAt: Date.now(), ...card };
    },
    // ---------------- 顶部入口 ----------------
    onOpenSearch() {
        wx.navigateTo({ url: '/pages/search/index' });
    },
    onOpenImport() {
        wx.navigateTo({ url: '/pages/import/index' });
    },
    onOpenSettings() {
        wx.navigateTo({ url: '/pages/settings/index' });
    },
    onBrandTouchStart(e) {
        brandStartY = e.touches[0] ? e.touches[0].clientY : 0;
        brandAxisLocked = false;
    },
    onBrandTouchMove(e) {
        const t = e.touches[0];
        if (!t)
            return;
        const delta = t.clientY - brandStartY;
        // 与原产品一致：未展开时下拉展开；已展开时上滑收起；触发一次后锁定本手势，避免抖动
        if (brandAxisLocked)
            return;
        if (!this.data.brandExpanded) {
            if (delta > 24) {
                brandAxisLocked = true;
                this.setData({ brandExpanded: true });
            }
        }
        else if (delta < -24) {
            brandAxisLocked = true;
            this.setData({ brandExpanded: false });
        }
    },
    onToggleBrand() {
        this.setData({ brandExpanded: !this.data.brandExpanded });
    },
    // ---------------- 卡片交互 ----------------
    onTapCard(e) {
        const id = String(e.currentTarget.dataset.id);
        const card = currentCards.find((c) => c.id === id);
        if (card)
            this.openCard(card);
    },
    onTapRow(e) {
        const articleUuid = String(e.currentTarget.dataset.article || '');
        const resume = String(e.currentTarget.dataset.resume || '') === '1';
        if (!articleUuid) {
            this.toastNoArticle();
            return;
        }
        this.practice(articleUuid, resume);
    },
    onLongPressCard(e) {
        const id = String(e.currentTarget.dataset.id);
        const card = currentCards.find((c) => c.id === id);
        if (!card)
            return;
        wx.showActionSheet({
            itemList: [card.pinned ? '取消固定' : '固定到最前', '删除卡片'],
            success: (res) => {
                if (res.tapIndex === 0)
                    this.togglePin(card);
                else if (res.tapIndex === 1)
                    this.confirmRemove(card);
            },
            fail: () => undefined,
        });
    },
    /** 按卡片类型分发跳转 */
    openCard(card) {
        const view = this.data.cards.find((c) => c.id === card.id);
        const articleUuid = (view ? view.articleUuid : card.articleUuid) || '';
        switch (card.type) {
            case 'ADD_ARTICLE':
                this.onOpenImport();
                return;
            case 'GLOBAL_STATS':
                wx.switchTab({ url: '/pages/overview/index' });
                return;
            case 'SENTENCE':
                wx.navigateTo({ url: '/packages/tools/pages/sentence-cards/index' });
                return;
            case 'CUSTOM_CLOZE':
                if (!articleUuid)
                    return this.toastNoArticle();
                wx.navigateTo({ url: `/packages/tools/pages/custom-cloze/index?articleUuid=${articleUuid}` });
                return;
            case 'CUSTOM_MASK':
                if (!articleUuid)
                    return this.toastNoArticle();
                wx.navigateTo({ url: `/packages/tools/pages/mask-config/index?articleUuid=${articleUuid}` });
                return;
            case 'STATS':
                if (!articleUuid)
                    return this.toastNoArticle();
                wx.navigateTo({ url: `/packages/stats/pages/statistics/index?articleUuid=${articleUuid}` });
                return;
            case 'CONTINUE':
                if (!articleUuid)
                    return this.toastNoArticle();
                this.practice(articleUuid, true);
                return;
            case 'ARTICLE':
                // 单篇文章：可选择练习或阅读
                if (!articleUuid)
                    return this.toastNoArticle();
                wx.showActionSheet({
                    itemList: ['开始练习', '进入阅读'],
                    success: (res) => {
                        if (res.tapIndex === 0)
                            this.practice(articleUuid, false);
                        else if (res.tapIndex === 1)
                            wx.navigateTo({ url: `/pages/reader/index?articleUuid=${articleUuid}` });
                    },
                    fail: () => undefined,
                });
                return;
            default:
                // DUE / RECENT：进入练习（模式由练习页选择）
                if (!articleUuid)
                    return this.toastNoArticle();
                this.practice(articleUuid, false);
                return;
        }
    },
    practice(articleUuid, resume) {
        const tail = resume ? '&resume=1' : '';
        wx.navigateTo({ url: `/pages/practice/index?articleUuid=${articleUuid}&mode=SENTENCE${tail}` });
    },
    toastNoArticle() {
        wx.showToast({ title: '暂无可练习的文章', icon: 'none' });
    },
    togglePin(card) {
        const next = (0, entities_1.getHomeLayout)().cards.map((c) => (c.id === card.id ? { ...c, pinned: !c.pinned } : c));
        (0, entities_1.saveHomeLayout)(next);
        this.refresh();
    },
    confirmRemove(card) {
        wx.showModal({
            title: '删除卡片',
            content: `确定移除「${card.title || card.type}」卡片吗？`,
            confirmText: '删除',
            success: (res) => {
                if (!res.confirm)
                    return;
                const next = (0, entities_1.getHomeLayout)().cards.filter((c) => c.id !== card.id);
                (0, entities_1.saveHomeLayout)(next);
                this.refresh();
            },
        });
    },
    // ---------------- 添加卡片 ----------------
    onOpenSheet() {
        this.setData({ sheetVisible: true });
    },
    onCloseSheet() {
        this.setData({ sheetVisible: false });
    },
    onAddCard(e) {
        const type = String(e.currentTarget.dataset.type || '');
        if (!type)
            return;
        const articles = entities_1.articleStore.list();
        let articleUuid = '';
        if ((0, homeLogic_1.needsArticle)(type)) {
            const recent = articles.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
            if (!recent) {
                wx.showToast({ title: '请先导入一篇文章', icon: 'none' });
                return;
            }
            articleUuid = recent.uuid;
        }
        const cards = (0, entities_1.getHomeLayout)().cards.slice();
        cards.push((0, homeLogic_1.makeCard)(type, articleUuid));
        (0, entities_1.saveHomeLayout)(cards);
        this.setData({ sheetVisible: false });
        this.refresh();
    },
});
