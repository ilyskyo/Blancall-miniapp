"use strict";
/**
 * 首页纯逻辑：卡片视图构建 / 默认布局 / 可添加类型
 * WXML 不支持函数调用与复杂表达式，所有派生数据都在这里算好后再 setData。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCardView = exports.percentText = exports.urgencyLabel = exports.addableOptions = exports.addableTypes = exports.sortCards = exports.defaultHomeCards = exports.makeCard = exports.needsArticle = exports.MODE_LABEL = exports.CARD_TYPE_ICON = exports.CARD_TYPE_LABEL = void 0;
const forgetting_1 = require("../../core/algorithms/forgetting");
const date_1 = require("../../core/utils/date");
const uuid_1 = require("../../core/utils/uuid");
exports.CARD_TYPE_LABEL = {
    DUE: '即将复习',
    CONTINUE: '继续练习',
    RECENT: '最近文章',
    ARTICLE: '单篇文章',
    CUSTOM_CLOZE: '自定义挖空',
    CUSTOM_MASK: '遮挡配置',
    ADD_ARTICLE: '导入文章',
    STATS: '单篇统计',
    GLOBAL_STATS: '学习数据',
    SENTENCE: '每日一句',
};
exports.CARD_TYPE_ICON = {
    DUE: '⏰',
    CONTINUE: '▶️',
    RECENT: '🕒',
    ARTICLE: '📖',
    CUSTOM_CLOZE: '🕳️',
    CUSTOM_MASK: '🧩',
    ADD_ARTICLE: '➕',
    STATS: '📈',
    GLOBAL_STATS: '📊',
    SENTENCE: '✨',
};
exports.MODE_LABEL = {
    SENTENCE: '句子挖空',
    WORD: '字词挖空',
    REVERSE: '反向默写',
};
/** 「添加卡片」面板中的类型顺序（按常用度） */
const ADD_ORDER = [
    'DUE',
    'CONTINUE',
    'RECENT',
    'SENTENCE',
    'ADD_ARTICLE',
    'STATS',
    'CUSTOM_CLOZE',
    'CUSTOM_MASK',
    'GLOBAL_STATS',
    'ARTICLE',
];
/** 需要绑定具体文章的卡片类型 */
function needsArticle(type) {
    return type === 'ARTICLE' || type === 'CUSTOM_CLOZE' || type === 'CUSTOM_MASK' || type === 'STATS';
}
exports.needsArticle = needsArticle;
/** 列表型卡片占两列（单列卡片并排显示） */
function isWide(type) {
    return type === 'DUE' || type === 'CONTINUE' || type === 'RECENT' || type === 'SENTENCE';
}
function makeCard(type, articleUuid) {
    return {
        id: `${type}-${(0, uuid_1.uuidv7)()}`,
        type,
        refUuid: '',
        articleUuid,
        colSpan: isWide(type) ? 2 : 1,
        rowSpan: 1,
        pinned: false,
        lockRow: false,
        lockCol: false,
        title: '',
    };
}
exports.makeCard = makeCard;
/** 首次进入时的默认卡片（每日一句置顶固定） */
function defaultHomeCards() {
    const types = ['SENTENCE', 'DUE', 'CONTINUE', 'RECENT', 'GLOBAL_STATS', 'ADD_ARTICLE'];
    return types.map((t, i) => {
        const card = makeCard(t, '');
        card.pinned = i === 0;
        return card;
    });
}
exports.defaultHomeCards = defaultHomeCards;
/** 固定卡片排前（保持其余相对顺序） */
function sortCards(cards) {
    return cards.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned));
}
exports.sortCards = sortCards;
/** 尚未加入布局的卡片类型（无文章时排除需要绑定文章的类型） */
function addableTypes(cards, hasArticles) {
    const used = new Set(cards.map((c) => c.type));
    return ADD_ORDER.filter((t) => !used.has(t) && (hasArticles || !needsArticle(t)));
}
exports.addableTypes = addableTypes;
function addableOptions(cards, hasArticles) {
    return addableTypes(cards, hasArticles).map((type) => ({
        type,
        label: exports.CARD_TYPE_LABEL[type],
        icon: exports.CARD_TYPE_ICON[type],
    }));
}
exports.addableOptions = addableOptions;
function urgencyLabel(urgency, daysLeft) {
    switch (urgency) {
        case forgetting_1.Urgency.OVERDUE:
            return '已逾期';
        case forgetting_1.Urgency.TODAY:
            return '今天到期';
        case forgetting_1.Urgency.SOON:
            return '3 天内';
        case forgetting_1.Urgency.LATER:
            return daysLeft > 0 ? `${daysLeft} 天后` : '稍后';
        case forgetting_1.Urgency.NEW:
            return '未开始练习';
        default:
            return '已掌握';
    }
}
exports.urgencyLabel = urgencyLabel;
function percentText(v) {
    return `${Math.round(v * 100)}%`;
}
exports.percentText = percentText;
function baseView(card) {
    const type = card.type;
    return {
        id: card.id,
        type,
        typeLabel: exports.CARD_TYPE_LABEL[type],
        title: card.title || exports.CARD_TYPE_LABEL[type],
        showTypeLabel: false,
        pinned: !!card.pinned,
        wide: card.colSpan >= 2,
        articleUuid: card.articleUuid || '',
        rows: [],
        metrics: [],
        sentence: '',
        sentenceSource: '',
        subtitle: '',
        footer: '',
        emptyText: '',
    };
}
/** 卡片目标文章：优先卡片绑定，其次最近更新的一篇 */
function targetArticle(card, inputs) {
    const list = inputs.articles;
    if (list.length === 0)
        return null;
    if (card.articleUuid) {
        const found = list.find((a) => a.uuid === card.articleUuid);
        if (found)
            return found;
    }
    return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
}
function buildCardView(card, inputs) {
    const view = baseView(card);
    switch (card.type) {
        case 'DUE': {
            view.emptyText = '暂无待复习内容';
            view.rows = inputs.due.slice(0, 3).map((p, i) => ({
                key: `due-${i}`,
                title: p.title,
                desc: urgencyLabel(p.urgency, p.daysLeft),
                badge: `${percentText(p.lastAccuracy)}`,
                articleUuid: p.articleId,
            }));
            view.footer = inputs.due.length > 0 ? `共 ${inputs.due.length} 篇待复习` : '';
            break;
        }
        case 'CONTINUE': {
            view.emptyText = '当前没有进行中的练习';
            view.rows = inputs.inProgress.slice(0, 3).map((it, i) => ({
                key: `continue-${i}`,
                title: it.articleTitle,
                desc: `${exports.MODE_LABEL[it.state.mode]} · 已答 ${it.state.answeredCount}/${it.state.totalBlanks}`,
                badge: '',
                articleUuid: it.state.articleUuid,
            }));
            break;
        }
        case 'RECENT': {
            view.emptyText = '暂无文章，先导入一篇吧';
            const recent = inputs.articles.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
            view.rows = recent.map((a, i) => ({
                key: `recent-${i}`,
                title: a.title,
                desc: `更新于 ${(0, date_1.formatShort)(a.updatedAt)}`,
                badge: a.author || '',
                articleUuid: a.uuid,
            }));
            break;
        }
        case 'SENTENCE': {
            if (inputs.sentence) {
                view.sentence = inputs.sentence.text;
                view.sentenceSource = inputs.sentence.title ? `—— ${inputs.sentence.title}` : '—— 每日一句';
            }
            else {
                view.sentence = '导入一篇文章后，这里会出现每日一句。';
                view.sentenceSource = '—— 每日一句';
            }
            break;
        }
        case 'ADD_ARTICLE': {
            view.subtitle = inputs.articles.length === 0 ? '导入第一篇文章' : '粘贴文本或从聊天记录选择文件';
            view.footer = '＋';
            break;
        }
        case 'GLOBAL_STATS': {
            const gs = inputs.globalStats;
            view.metrics = [
                { label: '正确率', value: percentText(gs.accuracy) },
                { label: '练习次数', value: `${gs.practiceCount}` },
                { label: '学习时长', value: (0, date_1.formatDuration)(gs.studySeconds) },
            ];
            view.footer = `连续学习 ${gs.streak} 天`;
            break;
        }
        case 'ARTICLE': {
            const article = targetArticle(card, inputs);
            if (!article) {
                view.emptyText = '暂无文章';
                break;
            }
            view.title = article.title;
            view.showTypeLabel = true;
            view.articleUuid = article.uuid;
            view.subtitle = article.author ? `${article.author} · 更新于 ${(0, date_1.formatShort)(article.updatedAt)}` : `更新于 ${(0, date_1.formatShort)(article.updatedAt)}`;
            view.footer = '点击开始练习';
            break;
        }
        case 'CUSTOM_CLOZE': {
            const article = targetArticle(card, inputs);
            if (!article) {
                view.emptyText = '暂无文章';
                break;
            }
            const count = inputs.clozeCounts[article.uuid] || 0;
            view.title = article.title;
            view.showTypeLabel = true;
            view.articleUuid = article.uuid;
            view.subtitle = count > 0 ? `${count} 套自定义挖空` : '还没有自定义挖空配置';
            view.footer = count > 0 ? '点击进入练习' : '点击新建配置';
            break;
        }
        case 'CUSTOM_MASK': {
            const article = targetArticle(card, inputs);
            if (!article) {
                view.emptyText = '暂无文章';
                break;
            }
            const count = inputs.maskCounts[article.uuid] || 0;
            view.title = article.title;
            view.showTypeLabel = true;
            view.articleUuid = article.uuid;
            view.subtitle = count > 0 ? `${count} 套遮挡配置` : '还没有自定义遮挡配置';
            view.footer = count > 0 ? '点击进入阅读' : '点击新建配置';
            break;
        }
        case 'STATS': {
            const article = targetArticle(card, inputs);
            if (!article) {
                view.emptyText = '暂无文章';
                break;
            }
            const st = inputs.articleStats[article.uuid] || { accuracy: 0, count: 0, bestAccuracy: 0 };
            view.title = article.title;
            view.showTypeLabel = true;
            view.articleUuid = article.uuid;
            view.metrics = [
                { label: '正确率', value: percentText(st.accuracy) },
                { label: '练习次数', value: `${st.count}` },
                { label: '最佳', value: percentText(st.bestAccuracy) },
            ];
            break;
        }
        default:
            break;
    }
    return view;
}
exports.buildCardView = buildCardView;
