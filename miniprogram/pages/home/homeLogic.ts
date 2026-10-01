/**
 * 首页纯逻辑：卡片视图构建 / 默认布局 / 可添加类型
 * WXML 不支持函数调用与复杂表达式，所有派生数据都在这里算好后再 setData。
 */

import { HomeCard, HomeCardType, PracticeStateEntity, SentenceCardEntity } from '../../core/storage/entities';
import { GlobalStats } from '../../core/stats/overview';
import { Prediction, Urgency } from '../../core/algorithms/forgetting';
import { ArticleEntity, PracticeMode } from '../../core/algorithms/types';
import { formatDuration, formatShort } from '../../core/utils/date';
import { uuidv7 } from '../../core/utils/uuid';

export const CARD_TYPE_LABEL: Record<HomeCardType, string> = {
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

export const CARD_TYPE_ICON: Record<HomeCardType, string> = {
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

export const MODE_LABEL: Record<PracticeMode, string> = {
  SENTENCE: '句子挖空',
  WORD: '字词挖空',
  REVERSE: '反向默写',
};

/** 「添加卡片」面板中的类型顺序（按常用度） */
const ADD_ORDER: HomeCardType[] = [
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
export function needsArticle(type: HomeCardType): boolean {
  return type === 'ARTICLE' || type === 'CUSTOM_CLOZE' || type === 'CUSTOM_MASK' || type === 'STATS';
}

/** 列表型卡片占两列（单列卡片并排显示） */
function isWide(type: HomeCardType): boolean {
  return type === 'DUE' || type === 'CONTINUE' || type === 'RECENT' || type === 'SENTENCE';
}

export function makeCard(type: HomeCardType, articleUuid: string): HomeCard {
  return {
    id: `${type}-${uuidv7()}`,
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

/** 首次进入时的默认卡片（每日一句置顶固定） */
export function defaultHomeCards(): HomeCard[] {
  const types: HomeCardType[] = ['SENTENCE', 'DUE', 'CONTINUE', 'RECENT', 'GLOBAL_STATS', 'ADD_ARTICLE'];
  return types.map((t, i) => {
    const card = makeCard(t, '');
    card.pinned = i === 0;
    return card;
  });
}

/** 固定卡片排前（保持其余相对顺序） */
export function sortCards(cards: HomeCard[]): HomeCard[] {
  return cards.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** 尚未加入布局的卡片类型（无文章时排除需要绑定文章的类型） */
export function addableTypes(cards: HomeCard[], hasArticles: boolean): HomeCardType[] {
  const used = new Set(cards.map((c) => c.type));
  return ADD_ORDER.filter((t) => !used.has(t) && (hasArticles || !needsArticle(t)));
}

export function addableOptions(cards: HomeCard[], hasArticles: boolean): Array<{ type: HomeCardType; label: string; icon: string }> {
  return addableTypes(cards, hasArticles).map((type) => ({
    type,
    label: CARD_TYPE_LABEL[type],
    icon: CARD_TYPE_ICON[type],
  }));
}

export function urgencyLabel(urgency: Urgency, daysLeft: number): string {
  switch (urgency) {
    case Urgency.OVERDUE:
      return '已逾期';
    case Urgency.TODAY:
      return '今天到期';
    case Urgency.SOON:
      return '3 天内';
    case Urgency.LATER:
      return daysLeft > 0 ? `${daysLeft} 天后` : '稍后';
    case Urgency.NEW:
      return '未开始练习';
    default:
      return '已掌握';
  }
}

export function percentText(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export interface HomeRow {
  key: string;
  title: string;
  desc: string;
  badge: string;
  articleUuid: string;
}

export interface HomeMetric {
  label: string;
  value: string;
}

export interface HomeCardView {
  id: string;
  type: HomeCardType;
  typeLabel: string;
  title: string;
  showTypeLabel: boolean;
  pinned: boolean;
  wide: boolean;
  articleUuid: string;
  rows: HomeRow[];
  metrics: HomeMetric[];
  sentence: string;
  sentenceSource: string;
  subtitle: string;
  footer: string;
  emptyText: string;
}

export interface CardInputs {
  articles: ArticleEntity[];
  due: Prediction[];
  inProgress: Array<{ state: PracticeStateEntity; articleTitle: string }>;
  globalStats: GlobalStats;
  articleStats: Record<string, { accuracy: number; count: number; bestAccuracy: number }>;
  clozeCounts: Record<string, number>;
  maskCounts: Record<string, number>;
  sentence: SentenceCardEntity | null;
  hasClozeCustom: boolean;
  hasOcclusionCustom: boolean;
}

function baseView(card: HomeCard): HomeCardView {
  const type = card.type;
  return {
    id: card.id,
    type,
    typeLabel: CARD_TYPE_LABEL[type],
    title: card.title || CARD_TYPE_LABEL[type],
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
function targetArticle(card: HomeCard, inputs: CardInputs): ArticleEntity | null {
  const list = inputs.articles;
  if (list.length === 0) return null;
  if (card.articleUuid) {
    const found = list.find((a) => a.uuid === card.articleUuid);
    if (found) return found;
  }
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function buildCardView(card: HomeCard, inputs: CardInputs): HomeCardView {
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
        desc: `${MODE_LABEL[it.state.mode]} · 已答 ${it.state.answeredCount}/${it.state.totalBlanks}`,
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
        desc: `更新于 ${formatShort(a.updatedAt)}`,
        badge: a.author || '',
        articleUuid: a.uuid,
      }));
      break;
    }
    case 'SENTENCE': {
      if (inputs.sentence) {
        view.sentence = inputs.sentence.text;
        view.sentenceSource = inputs.sentence.title ? `—— ${inputs.sentence.title}` : '—— 每日一句';
      } else {
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
        { label: '学习时长', value: formatDuration(gs.studySeconds) },
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
      view.subtitle = article.author ? `${article.author} · 更新于 ${formatShort(article.updatedAt)}` : `更新于 ${formatShort(article.updatedAt)}`;
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