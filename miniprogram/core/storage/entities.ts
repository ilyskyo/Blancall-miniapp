/**
 * 实体存储（本地权威副本；登录用户与服务端双向增量同步）
 * 对应 Android 端：articles.json / records.jsonl / tags.json / practice_state_*.json /
 * fsrs_state.json / custom_cloze.json / mask_config.json / reader_prefs.json / home_layout.json /
 * sentence_card.json / study_stat（新增，用于学习时长排行榜）
 */

import { DB_DIR } from './fs';
import { JsonCollection, JsonlCollection, SyncableRecord } from './collection';
import { PracticeMode, PracticeRecordEntity, ArticleEntity, FsrsState, MistakeDetail } from '../algorithms/types';
import { uuidv7 } from '../utils/uuid';
import { dateKey } from '../utils/date';
import { hash16, md5Hex } from '../utils/digest';

// ============================== 实体类型 ==============================

export interface TagEntity extends SyncableRecord {
  name: string;
  color: number;
  order: number;
}

export interface TagLinkEntity extends SyncableRecord {
  articleUuid: string;
  tagUuid: string;
}

export interface PracticeStateEntity extends SyncableRecord {
  articleUuid: string;
  mode: PracticeMode;
  status: 'IN_PROGRESS' | 'COMPLETED';
  totalBlanks: number;
  answeredCount: number;
  answers: Record<string, string>;
  dictationInput: string;
  clozeJson: string;
  configUuid: string;
  lastPracticeTime: number;
}

export interface FsrsRecord extends SyncableRecord, FsrsState {
  /** FSRS 键：文章 uuid 或 `s:<articleUuid>:<hash16>` */
  key: string;
}

export interface CustomClozeBlank {
  /** 句子索引 */
  s: number;
  /** 句内起始 */
  a: number;
  /** 句内结束（exclusive） */
  b: number;
}

export interface CustomClozeEntity extends SyncableRecord {
  articleUuid: string;
  name: string;
  createdAt: number;
  mode: PracticeMode;
  levels: number[];
  contentHash: string;
  blanks: CustomClozeBlank[];
}

export interface MaskSpanData {
  /** 段索引 */
  p: number;
  /** 段内起始 */
  a: number;
  /** 段内结束（exclusive） */
  e: number;
  /** 颜色索引 0..5 */
  c: number;
}

export interface MaskConfigEntity extends SyncableRecord {
  articleUuid: string;
  name: string;
  createdAt: number;
  contentHash: string;
  spans: MaskSpanData[];
  /** 是否为该文章的当前选中配置 */
  selected: boolean;
}

export interface ReaderPrefsEntity extends SyncableRecord {
  articleUuid: string;
  bgMode: number;
  fontId: string;
  fontWeight: number;
  fontPx: number;
  lineHeight: number;
  layoutMode: number;
  occlusionEnabled: boolean;
  occlusionMode: string;
  occlusionColor: number;
  occlusionCustomConfigUuid: string;
}

/** 首页卡片类型（对应 HomeLayoutStore.CardType） */
export type HomeCardType =
  | 'DUE'
  | 'CONTINUE'
  | 'RECENT'
  | 'ARTICLE'
  | 'CUSTOM_CLOZE'
  | 'CUSTOM_MASK'
  | 'ADD_ARTICLE'
  | 'STATS'
  | 'GLOBAL_STATS'
  | 'SENTENCE';

export interface HomeCard {
  id: string;
  type: HomeCardType;
  refUuid: string;
  articleUuid: string;
  colSpan: number;
  rowSpan: number;
  pinned: boolean;
  lockRow: boolean;
  lockCol: boolean;
  title: string;
}

export interface HomeLayoutEntity extends SyncableRecord {
  cards: HomeCard[];
}

export interface StudyStatEntity extends SyncableRecord {
  /** YYYY-MM-DD */
  date: string;
  practiceSeconds: number;
  readingSeconds: number;
  practiceCount: number;
}

export interface SentenceCardEntity extends SyncableRecord {
  date: string;
  key: string;
  articleUuid: string;
  text: string;
  start: number;
  end: number;
  title: string;
}

// ============================== 存储实例 ==============================

export const articleStore = new JsonCollection<ArticleEntity>(`${DB_DIR}/articles.json`, 'article');
export const recordStore = new JsonlCollection<PracticeRecordEntity>(`${DB_DIR}/records.jsonl`, 'practice_record');
export const tagStore = new JsonCollection<TagEntity>(`${DB_DIR}/tags.json`, 'tag');
export const tagLinkStore = new JsonCollection<TagLinkEntity>(`${DB_DIR}/tag_links.json`, 'tag_link');
export const practiceStateStore = new JsonCollection<PracticeStateEntity>(
  `${DB_DIR}/practice_state.json`,
  'practice_state'
);
export const fsrsStore = new JsonCollection<FsrsRecord>(`${DB_DIR}/fsrs_state.json`, 'fsrs');
export const customClozeStore = new JsonCollection<CustomClozeEntity>(`${DB_DIR}/custom_cloze.json`, 'custom_cloze');
export const maskConfigStore = new JsonCollection<MaskConfigEntity>(`${DB_DIR}/mask_config.json`, 'mask_config');
export const readerPrefsStore = new JsonCollection<ReaderPrefsEntity>(`${DB_DIR}/reader_prefs.json`, 'reader_prefs');
export const homeLayoutStore = new JsonCollection<HomeLayoutEntity>(`${DB_DIR}/home_layout.json`, 'home_layout');
export const studyStatStore = new JsonCollection<StudyStatEntity>(`${DB_DIR}/study_stat.json`, 'study_stat');
export const sentenceCardStore = new JsonCollection<SentenceCardEntity>(`${DB_DIR}/sentence_card.json`, 'sentence_card');

const HOME_LAYOUT_UUID = 'singleton';

// ============================== 按文章索引（性能） ==============================

/**
 * 首页/列表/统计需要"每篇文章的 记录/标签/挖空/遮罩/统计"。
 * 逐个调用 recordsOfArticle() 等函数会形成 O(文章数 × 记录数) 的重复全表扫描
 * （曾出现的性能缺陷：60 篇文章时每次 onShow 产生数十万次比较）。
 *
 * 这里用「写入版本号」做缓存失效：任何落盘变更都会让对应集合的 revision 变化，
 * 索引随之下次访问时重建；未变更时命中缓存，各取数函数退化为 O(1)。
 */
interface ArticleIndexCache {
  key: number;
  records: Map<string, PracticeRecordEntity[]>;
  recordStats: Map<string, ArticleStatLite>;
  tags: Map<string, TagEntity[]>;
  clozes: Map<string, CustomClozeEntity[]>;
  masks: Map<string, MaskConfigEntity[]>;
}

/** 单篇统计的轻量结构（避免与 core/stats 循环依赖） */
export interface ArticleStatLite {
  count: number;
  totalBlanks: number;
  correctCount: number;
  bestAccuracy: number;
  lastAt: number;
}

let articleIndex: ArticleIndexCache | null = null;

function indexKey(): number {
  // 参与索引的集合版本号组合（order/bit-shift 不必要，简单相加即可判定变化）
  return (
    recordStore.revision() * 1000003 +
    tagStore.revision() * 1000033 +
    tagLinkStore.revision() * 1000037 +
    customClozeStore.revision() * 1000039 +
    maskConfigStore.revision() * 1000081
  );
}

function buildIndex(): ArticleIndexCache {
  const records = new Map<string, PracticeRecordEntity[]>();
  const recordStats = new Map<string, ArticleStatLite>();
  for (const record of recordStore.list()) {
    const list = records.get(record.articleUuid);
    if (list) list.push(record);
    else records.set(record.articleUuid, [record]);
  }
  records.forEach((list, articleUuid) => {
    let totalBlanks = 0;
    let correctCount = 0;
    let bestAccuracy = 0;
    let lastAt = 0;
    for (const r of list) {
      totalBlanks += r.totalBlanks;
      correctCount += r.correctCount;
      if (r.totalBlanks > 0) bestAccuracy = Math.max(bestAccuracy, r.correctCount / r.totalBlanks);
      lastAt = Math.max(lastAt, r.timestamp);
    }
    recordStats.set(articleUuid, { count: list.length, totalBlanks, correctCount, bestAccuracy, lastAt });
  });

  const tags = new Map<string, TagEntity[]>();
  const tagDict = new Map(tagStore.list().map((t) => [t.uuid, t] as const));
  for (const link of tagLinkStore.list()) {
    const tag = tagDict.get(link.tagUuid);
    if (!tag) continue;
    const list = tags.get(link.articleUuid);
    if (list) list.push(tag);
    else tags.set(link.articleUuid, [tag]);
  }
  tags.forEach((list) => list.sort((a, b) => a.order - b.order));

  const clozes = new Map<string, CustomClozeEntity[]>();
  for (const c of customClozeStore.list()) {
    const list = clozes.get(c.articleUuid);
    if (list) list.push(c);
    else clozes.set(c.articleUuid, [c]);
  }
  clozes.forEach((list) => list.sort((a, b) => a.createdAt - b.createdAt));

  const masks = new Map<string, MaskConfigEntity[]>();
  for (const m of maskConfigStore.list()) {
    const list = masks.get(m.articleUuid);
    if (list) list.push(m);
    else masks.set(m.articleUuid, [m]);
  }
  masks.forEach((list) => list.sort((a, b) => a.createdAt - b.createdAt));

  return { key: indexKey(), records, recordStats, tags, clozes, masks };
}

function getIndex(): ArticleIndexCache {
  const key = indexKey();
  if (!articleIndex || articleIndex.key !== key) {
    articleIndex = buildIndex();
  }
  return articleIndex;
}

/** 主动失效（删除文章等批量变更后调用；版本号变化也会自动失效，双保险） */
export function invalidateArticleIndex(): void {
  articleIndex = null;
}

/** 批量：按文章分组的记录（首页/列表一次取全量，避免循环内重复扫描） */
export function recordsByArticle(): Map<string, PracticeRecordEntity[]> {
  return getIndex().records;
}

/** 批量：按文章分组的统计（count/正确数/最佳正确率/最近时间） */
export function statsByArticle(): Map<string, ArticleStatLite> {
  return getIndex().recordStats;
}

/** 批量：按文章分组的标签 */
export function tagsByArticle(): Map<string, TagEntity[]> {
  return getIndex().tags;
}

/** 批量：按文章分组的自定义挖空配置 */
export function clozesByArticle(): Map<string, CustomClozeEntity[]> {
  return getIndex().clozes;
}

/** 批量：按文章分组的遮罩配置 */
export function masksByArticle(): Map<string, MaskConfigEntity[]> {
  return getIndex().masks;
}

// ============================== 文章 ==============================

export function createArticle(input: {
  title: string;
  content: string;
  author?: string;
  /** TXT 等纯文本默认自动首行缩进；PDF/DOCX 等保持原文不缩进 */
  autoIndent?: boolean;
}): ArticleEntity {
  const now = Date.now();
  const article: ArticleEntity = {
    uuid: uuidv7(now),
    title: input.title || '未命名',
    content: input.content,
    author: input.author || '',
    autoIndent: input.autoIndent !== false,
    createdAt: now,
    updatedAt: now,
  };
  articleStore.upsert(article);
  return article;
}

export function updateArticle(uuid: string, patch: Partial<Omit<ArticleEntity, 'uuid'>>): ArticleEntity | null {
  const cur = articleStore.find(uuid);
  if (!cur) return null;
  const next: ArticleEntity = { ...cur, ...patch, uuid: cur.uuid, updatedAt: Date.now() };
  articleStore.upsert(next);
  return next;
}

export function articleContentHash(content: string): string {
  return md5Hex(content);
}

/** 删除文章并级联清理关联数据（记录保留，便于统计回看） */
export function deleteArticleCascade(uuid: string): void {
  articleStore.remove(uuid);
  practiceStateStore.remove(uuid);
  readerPrefsStore.remove(uuid);
  customClozeStore.list().filter((c) => c.articleUuid === uuid).forEach((c) => customClozeStore.remove(c.uuid));
  maskConfigStore.list().filter((c) => c.articleUuid === uuid).forEach((c) => maskConfigStore.remove(c.uuid));
  tagLinkStore.list().filter((l) => l.articleUuid === uuid).forEach((l) => tagLinkStore.remove(l.uuid));
  // 句级 FSRS 键形如 `<articleUuid>:<hash16>`
  fsrsStore.list().filter((s) => s.key.startsWith(`${uuid}:`) || s.key === uuid).forEach((s) => fsrsStore.remove(s.uuid));
  // 每日句卡若指向该文章会变成"点开找不到文章"的悬空入口 → 一并清理（当天可重新抽取）
  sentenceCardStore.list().filter((c) => c.articleUuid === uuid).forEach((c) => sentenceCardStore.remove(c.uuid, { silent: true }));
}

// ============================== 练习记录 ==============================

export function appendRecord(record: Omit<PracticeRecordEntity, 'uuid'> & { uuid?: string }): PracticeRecordEntity {
  const item: PracticeRecordEntity = { ...record, uuid: record.uuid || uuidv7() } as PracticeRecordEntity;
  recordStore.append(item);
  const stat = ensureStudyStat(dateKey(item.timestamp));
  stat.practiceSeconds += Math.round((item.duration || 0) / 1000);
  stat.practiceCount += 1;
  studyStatStore.upsert({ ...stat, updatedAt: Date.now() });
  return item;
}

export function recordsOfArticle(articleUuid: string): PracticeRecordEntity[] {
  // 走按文章索引（O(1)），并按时间倒序返回副本以免调用方修改缓存
  const list = recordsByArticle().get(articleUuid) || [];
  return list.slice().sort((a, b) => b.timestamp - a.timestamp);
}

export function mistakesOfRecords(records: PracticeRecordEntity[]): MistakeDetail[] {
  const out: MistakeDetail[] = [];
  for (const r of records) for (const m of r.mistakes) out.push(m);
  return out;
}

// ============================== 标签 ==============================

export function createTag(name: string, color: number): TagEntity {
  const tags = tagStore.list();
  const item: TagEntity = { uuid: uuidv7(), name, color, order: tags.length, updatedAt: Date.now() };
  tagStore.upsert(item);
  return item;
}

export function tagsOfArticle(articleUuid: string): TagEntity[] {
  return (tagsByArticle().get(articleUuid) || []).slice();
}

export function setArticleTags(articleUuid: string, tagUuids: string[]): void {
  const existing = tagLinkStore.list().filter((l) => l.articleUuid === articleUuid);
  for (const l of existing) {
    if (!tagUuids.includes(l.tagUuid)) tagLinkStore.remove(l.uuid);
  }
  const has = new Set(existing.map((l) => l.tagUuid));
  for (const t of tagUuids) {
    if (has.has(t)) continue;
    tagLinkStore.upsert({
      uuid: `${articleUuid}:${t}`,
      articleUuid,
      tagUuid: t,
      updatedAt: Date.now(),
    });
  }
}

export function deleteTag(tagUuid: string): void {
  tagLinkStore.list().filter((l) => l.tagUuid === tagUuid).forEach((l) => tagLinkStore.remove(l.uuid));
  tagStore.remove(tagUuid);
}

// ============================== 练习进度（断点续练） ==============================

export function saveProgress(state: Omit<PracticeStateEntity, 'uuid' | 'updatedAt'>): void {
  practiceStateStore.upsert({ ...state, uuid: state.articleUuid, updatedAt: Date.now() });
}

export function getProgress(articleUuid: string): PracticeStateEntity | null {
  return practiceStateStore.find(articleUuid) || null;
}

export function clearProgress(articleUuid: string): void {
  practiceStateStore.remove(articleUuid);
}

/** 全部进行中的练习（首页「继续练习」卡片） */
export function inProgressStates(): PracticeStateEntity[] {
  return practiceStateStore
    .list()
    .filter((s) => s.status === 'IN_PROGRESS')
    .sort((a, b) => b.lastPracticeTime - a.lastPracticeTime);
}

// ============================== FSRS ==============================

export function articleFsrsKey(articleUuid: string): string {
  return articleUuid;
}

export function sentenceFsrsKey(articleUuid: string, text: string): string {
  return `s:${articleUuid}:${hash16(text)}`;
}

export function getFsrs(key: string): FsrsState | null {
  const rec = fsrsStore.find(key);
  return rec || null;
}

export function setFsrs(key: string, state: FsrsState): void {
  fsrsStore.upsert({ uuid: key, key, ...state, updatedAt: Date.now() });
}

export function allFsrs(): FsrsRecord[] {
  return fsrsStore.list();
}

// ============================== 自定义挖空 ==============================

export function customClozeOfArticle(articleUuid: string): CustomClozeEntity[] {
  return (clozesByArticle().get(articleUuid) || []).slice();
}

// ============================== 遮罩配置 ==============================

export function maskConfigsOfArticle(articleUuid: string): MaskConfigEntity[] {
  return (masksByArticle().get(articleUuid) || []).slice();
}

export function activeMaskConfig(articleUuid: string): MaskConfigEntity | null {
  const list = maskConfigsOfArticle(articleUuid);
  return list.find((c) => c.selected) || null;
}

export function selectMaskConfig(articleUuid: string, configUuid: string): void {
  for (const c of maskConfigsOfArticle(articleUuid)) {
    const selected = c.uuid === configUuid;
    if (c.selected !== selected) maskConfigStore.upsert({ ...c, selected, updatedAt: Date.now() });
  }
}

// ============================== 阅读偏好 ==============================

export function getReaderPrefs(articleUuid: string): ReaderPrefsEntity {
  const cur = readerPrefsStore.find(articleUuid);
  if (cur) return cur;
  return {
    uuid: articleUuid,
    articleUuid,
    bgMode: 0,
    fontId: '0',
    fontWeight: 400,
    fontPx: 17,
    lineHeight: 2.0,
    layoutMode: 0,
    occlusionEnabled: false,
    occlusionMode: 'long',
    occlusionColor: 0,
    occlusionCustomConfigUuid: '',
    updatedAt: 0,
  };
}

export function saveReaderPrefs(articleUuid: string, patch: Partial<Omit<ReaderPrefsEntity, 'uuid' | 'articleUuid'>>): void {
  const cur = getReaderPrefs(articleUuid);
  readerPrefsStore.upsert({ ...cur, ...patch, uuid: articleUuid, articleUuid, updatedAt: Date.now() });
}

// ============================== 首页布局 ==============================

export function getHomeLayout(): HomeLayoutEntity {
  const cur = homeLayoutStore.find(HOME_LAYOUT_UUID);
  if (cur && Array.isArray(cur.cards)) return cur;
  return { uuid: HOME_LAYOUT_UUID, cards: [], updatedAt: 0 };
}

export function saveHomeLayout(cards: HomeCard[]): void {
  homeLayoutStore.upsert({ uuid: HOME_LAYOUT_UUID, cards, updatedAt: Date.now() });
}

// ============================== 学习时长统计 ==============================

export function ensureStudyStat(date: string): StudyStatEntity {
  const cur = studyStatStore.find(date);
  if (cur) return cur;
  return { uuid: date, date, practiceSeconds: 0, readingSeconds: 0, practiceCount: 0, updatedAt: 0 };
}

export function addReadingSeconds(seconds: number, ts: number = Date.now()): void {
  if (seconds <= 0) return;
  const stat = ensureStudyStat(dateKey(ts));
  studyStatStore.upsert({ ...stat, readingSeconds: stat.readingSeconds + Math.round(seconds), updatedAt: Date.now() });
}

/** 累计学习时长（秒）＝练习时长 + 阅读时长，与统计页口径一致 */
export function totalStudySeconds(): number {
  return studyStatStore.list().reduce((sum, s) => sum + (s.practiceSeconds || 0) + (s.readingSeconds || 0), 0);
}

export function studySecondsBetween(fromDate: string, toDate: string): number {
  return studyStatStore
    .list()
    .filter((s) => s.date >= fromDate && s.date <= toDate)
    .reduce((sum, s) => sum + (s.practiceSeconds || 0) + (s.readingSeconds || 0), 0);
}

// ============================== 每日句卡 ==============================

export function getSentenceCard(date: string = dateKey()): SentenceCardEntity | null {
  const cur = sentenceCardStore.find('today');
  if (cur && cur.date === date) return cur;
  return null;
}

export function saveSentenceCard(card: Omit<SentenceCardEntity, 'uuid' | 'updatedAt'>): void {
  sentenceCardStore.upsert({ ...card, uuid: 'today', updatedAt: Date.now() }, { silent: true });
}