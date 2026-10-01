/**
 * 每日句卡纯逻辑：句级 FSRS 状态收集 / 轮转抽句 / 卡片构建
 */

import { ArticleEntity } from '../../../../core/algorithms/types';
import { CardState } from '../../../../core/algorithms/fsrs';
import { Pick, Rng, SentenceSelector } from '../../../../core/algorithms/sentenceSelector';
import { FsrsRecord, SentenceCardEntity } from '../../../../core/storage/entities';
import { dateKey } from '../../../../core/utils/date';

/** 从 FSRS 记录中筛出句子级状态（键前缀 s:） */
export function sentenceStates(records: FsrsRecord[]): Map<string, CardState> {
  const m = new Map<string, CardState>();
  for (const r of records) if (r.key.startsWith('s:')) m.set(r.key, r);
  return m;
}

/** 抽中句 → 句卡实体载荷 */
export function toCardPayload(
  pick: Pick,
  articles: ArticleEntity[],
  date: string
): Omit<SentenceCardEntity, 'uuid' | 'updatedAt'> {
  const article = articles.find((a) => a.uuid === pick.articleId);
  return {
    date,
    key: pick.key,
    articleUuid: pick.articleId,
    text: pick.text,
    start: pick.start,
    end: pick.end,
    title: article ? article.title : '',
  };
}

/** 随机抽一句（排除指定键），用于「换一句」兜底 */
function randomPick(articles: ArticleEntity[], states: Map<string, CardState>, excludeKey: string, rng?: Rng): Pick | null {
  const pool: Pick[] = [];
  for (const article of articles) {
    for (const c of SentenceSelector.candidates(article)) {
      if (c.key === excludeKey) continue;
      pool.push(c);
    }
  }
  if (pool.length === 0) return null;
  const fresh = pool.filter((c) => !states.has(c.key));
  const list = fresh.length > 0 ? fresh : pool;
  const idx = rng ? rng.nextInt(list.length) : Math.floor(Math.random() * list.length);
  return list[idx];
}

/**
 * 抽取下一张句卡：优先轮转规则 pickNew；当结果与 excludeKey 相同（换一句场景）时改随机抽不同的句子。
 */
export function pickNextCard(articles: ArticleEntity[], records: FsrsRecord[], excludeKey = ''): Pick | null {
  const states = sentenceStates(records);
  const pick = SentenceSelector.pickNew(articles, states);
  if (pick && (!excludeKey || pick.key !== excludeKey)) return pick;
  return randomPick(articles, states, excludeKey);
}

/** 今日卡片展示文案 */
export function today(): string {
  return dateKey();
}