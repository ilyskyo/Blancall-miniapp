"use strict";
/**
 * 实体存储（本地权威副本；登录用户与服务端双向增量同步）
 * 对应 Android 端：articles.json / records.jsonl / tags.json / practice_state_*.json /
 * fsrs_state.json / custom_cloze.json / mask_config.json / reader_prefs.json / home_layout.json /
 * sentence_card.json / study_stat（新增，用于学习时长排行榜）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.studySecondsBetween = exports.totalStudySeconds = exports.addReadingSeconds = exports.ensureStudyStat = exports.saveHomeLayout = exports.getHomeLayout = exports.saveReaderPrefs = exports.getReaderPrefs = exports.selectMaskConfig = exports.activeMaskConfig = exports.maskConfigsOfArticle = exports.customClozeOfArticle = exports.allFsrs = exports.setFsrs = exports.getFsrs = exports.sentenceFsrsKey = exports.articleFsrsKey = exports.inProgressStates = exports.clearProgress = exports.getProgress = exports.saveProgress = exports.deleteTag = exports.setArticleTags = exports.tagsOfArticle = exports.createTag = exports.mistakesOfRecords = exports.recordsOfArticle = exports.appendRecord = exports.deleteArticleCascade = exports.articleContentHash = exports.updateArticle = exports.createArticle = exports.masksByArticle = exports.clozesByArticle = exports.tagsByArticle = exports.statsByArticle = exports.recordsByArticle = exports.invalidateArticleIndex = exports.sentenceCardStore = exports.studyStatStore = exports.homeLayoutStore = exports.readerPrefsStore = exports.maskConfigStore = exports.customClozeStore = exports.fsrsStore = exports.practiceStateStore = exports.tagLinkStore = exports.tagStore = exports.recordStore = exports.articleStore = void 0;
exports.saveSentenceCard = exports.getSentenceCard = void 0;
const fs_1 = require("./fs");
const collection_1 = require("./collection");
const uuid_1 = require("../utils/uuid");
const date_1 = require("../utils/date");
const digest_1 = require("../utils/digest");
// ============================== 存储实例 ==============================
exports.articleStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/articles.json`, 'article');
exports.recordStore = new collection_1.JsonlCollection(`${fs_1.DB_DIR}/records.jsonl`, 'practice_record');
exports.tagStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/tags.json`, 'tag');
exports.tagLinkStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/tag_links.json`, 'tag_link');
exports.practiceStateStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/practice_state.json`, 'practice_state');
exports.fsrsStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/fsrs_state.json`, 'fsrs');
exports.customClozeStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/custom_cloze.json`, 'custom_cloze');
exports.maskConfigStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/mask_config.json`, 'mask_config');
exports.readerPrefsStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/reader_prefs.json`, 'reader_prefs');
exports.homeLayoutStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/home_layout.json`, 'home_layout');
exports.studyStatStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/study_stat.json`, 'study_stat');
exports.sentenceCardStore = new collection_1.JsonCollection(`${fs_1.DB_DIR}/sentence_card.json`, 'sentence_card');
const HOME_LAYOUT_UUID = 'singleton';
let articleIndex = null;
function indexKey() {
    // 参与索引的集合版本号组合（order/bit-shift 不必要，简单相加即可判定变化）
    return (exports.recordStore.revision() * 1000003 +
        exports.tagStore.revision() * 1000033 +
        exports.tagLinkStore.revision() * 1000037 +
        exports.customClozeStore.revision() * 1000039 +
        exports.maskConfigStore.revision() * 1000081);
}
function buildIndex() {
    const records = new Map();
    const recordStats = new Map();
    for (const record of exports.recordStore.list()) {
        const list = records.get(record.articleUuid);
        if (list)
            list.push(record);
        else
            records.set(record.articleUuid, [record]);
    }
    records.forEach((list, articleUuid) => {
        let totalBlanks = 0;
        let correctCount = 0;
        let bestAccuracy = 0;
        let lastAt = 0;
        for (const r of list) {
            totalBlanks += r.totalBlanks;
            correctCount += r.correctCount;
            if (r.totalBlanks > 0)
                bestAccuracy = Math.max(bestAccuracy, r.correctCount / r.totalBlanks);
            lastAt = Math.max(lastAt, r.timestamp);
        }
        recordStats.set(articleUuid, { count: list.length, totalBlanks, correctCount, bestAccuracy, lastAt });
    });
    const tags = new Map();
    const tagDict = new Map(exports.tagStore.list().map((t) => [t.uuid, t]));
    for (const link of exports.tagLinkStore.list()) {
        const tag = tagDict.get(link.tagUuid);
        if (!tag)
            continue;
        const list = tags.get(link.articleUuid);
        if (list)
            list.push(tag);
        else
            tags.set(link.articleUuid, [tag]);
    }
    tags.forEach((list) => list.sort((a, b) => a.order - b.order));
    const clozes = new Map();
    for (const c of exports.customClozeStore.list()) {
        const list = clozes.get(c.articleUuid);
        if (list)
            list.push(c);
        else
            clozes.set(c.articleUuid, [c]);
    }
    clozes.forEach((list) => list.sort((a, b) => a.createdAt - b.createdAt));
    const masks = new Map();
    for (const m of exports.maskConfigStore.list()) {
        const list = masks.get(m.articleUuid);
        if (list)
            list.push(m);
        else
            masks.set(m.articleUuid, [m]);
    }
    masks.forEach((list) => list.sort((a, b) => a.createdAt - b.createdAt));
    return { key: indexKey(), records, recordStats, tags, clozes, masks };
}
function getIndex() {
    const key = indexKey();
    if (!articleIndex || articleIndex.key !== key) {
        articleIndex = buildIndex();
    }
    return articleIndex;
}
/** 主动失效（删除文章等批量变更后调用；版本号变化也会自动失效，双保险） */
function invalidateArticleIndex() {
    articleIndex = null;
}
exports.invalidateArticleIndex = invalidateArticleIndex;
/** 批量：按文章分组的记录（首页/列表一次取全量，避免循环内重复扫描） */
function recordsByArticle() {
    return getIndex().records;
}
exports.recordsByArticle = recordsByArticle;
/** 批量：按文章分组的统计（count/正确数/最佳正确率/最近时间） */
function statsByArticle() {
    return getIndex().recordStats;
}
exports.statsByArticle = statsByArticle;
/** 批量：按文章分组的标签 */
function tagsByArticle() {
    return getIndex().tags;
}
exports.tagsByArticle = tagsByArticle;
/** 批量：按文章分组的自定义挖空配置 */
function clozesByArticle() {
    return getIndex().clozes;
}
exports.clozesByArticle = clozesByArticle;
/** 批量：按文章分组的遮罩配置 */
function masksByArticle() {
    return getIndex().masks;
}
exports.masksByArticle = masksByArticle;
// ============================== 文章 ==============================
function createArticle(input) {
    const now = Date.now();
    const article = {
        uuid: (0, uuid_1.uuidv7)(now),
        title: input.title || '未命名',
        content: input.content,
        author: input.author || '',
        autoIndent: input.autoIndent !== false,
        createdAt: now,
        updatedAt: now,
    };
    exports.articleStore.upsert(article);
    return article;
}
exports.createArticle = createArticle;
function updateArticle(uuid, patch) {
    const cur = exports.articleStore.find(uuid);
    if (!cur)
        return null;
    const next = { ...cur, ...patch, uuid: cur.uuid, updatedAt: Date.now() };
    exports.articleStore.upsert(next);
    return next;
}
exports.updateArticle = updateArticle;
function articleContentHash(content) {
    return (0, digest_1.md5Hex)(content);
}
exports.articleContentHash = articleContentHash;
/** 删除文章并级联清理关联数据（记录保留，便于统计回看） */
function deleteArticleCascade(uuid) {
    exports.articleStore.remove(uuid);
    exports.practiceStateStore.remove(uuid);
    exports.readerPrefsStore.remove(uuid);
    exports.customClozeStore.list().filter((c) => c.articleUuid === uuid).forEach((c) => exports.customClozeStore.remove(c.uuid));
    exports.maskConfigStore.list().filter((c) => c.articleUuid === uuid).forEach((c) => exports.maskConfigStore.remove(c.uuid));
    exports.tagLinkStore.list().filter((l) => l.articleUuid === uuid).forEach((l) => exports.tagLinkStore.remove(l.uuid));
    // 句级 FSRS 键形如 `<articleUuid>:<hash16>`
    exports.fsrsStore.list().filter((s) => s.key.startsWith(`${uuid}:`) || s.key === uuid).forEach((s) => exports.fsrsStore.remove(s.uuid));
    // 每日句卡若指向该文章会变成"点开找不到文章"的悬空入口 → 一并清理（当天可重新抽取）
    exports.sentenceCardStore.list().filter((c) => c.articleUuid === uuid).forEach((c) => exports.sentenceCardStore.remove(c.uuid, { silent: true }));
}
exports.deleteArticleCascade = deleteArticleCascade;
// ============================== 练习记录 ==============================
function appendRecord(record) {
    const item = { ...record, uuid: record.uuid || (0, uuid_1.uuidv7)() };
    exports.recordStore.append(item);
    const stat = ensureStudyStat((0, date_1.dateKey)(item.timestamp));
    stat.practiceSeconds += Math.round((item.duration || 0) / 1000);
    stat.practiceCount += 1;
    exports.studyStatStore.upsert({ ...stat, updatedAt: Date.now() });
    return item;
}
exports.appendRecord = appendRecord;
function recordsOfArticle(articleUuid) {
    // 走按文章索引（O(1)），并按时间倒序返回副本以免调用方修改缓存
    const list = recordsByArticle().get(articleUuid) || [];
    return list.slice().sort((a, b) => b.timestamp - a.timestamp);
}
exports.recordsOfArticle = recordsOfArticle;
function mistakesOfRecords(records) {
    const out = [];
    for (const r of records)
        for (const m of r.mistakes)
            out.push(m);
    return out;
}
exports.mistakesOfRecords = mistakesOfRecords;
// ============================== 标签 ==============================
function createTag(name, color) {
    const tags = exports.tagStore.list();
    const item = { uuid: (0, uuid_1.uuidv7)(), name, color, order: tags.length, updatedAt: Date.now() };
    exports.tagStore.upsert(item);
    return item;
}
exports.createTag = createTag;
function tagsOfArticle(articleUuid) {
    return (tagsByArticle().get(articleUuid) || []).slice();
}
exports.tagsOfArticle = tagsOfArticle;
function setArticleTags(articleUuid, tagUuids) {
    const existing = exports.tagLinkStore.list().filter((l) => l.articleUuid === articleUuid);
    for (const l of existing) {
        if (!tagUuids.includes(l.tagUuid))
            exports.tagLinkStore.remove(l.uuid);
    }
    const has = new Set(existing.map((l) => l.tagUuid));
    for (const t of tagUuids) {
        if (has.has(t))
            continue;
        exports.tagLinkStore.upsert({
            uuid: `${articleUuid}:${t}`,
            articleUuid,
            tagUuid: t,
            updatedAt: Date.now(),
        });
    }
}
exports.setArticleTags = setArticleTags;
function deleteTag(tagUuid) {
    exports.tagLinkStore.list().filter((l) => l.tagUuid === tagUuid).forEach((l) => exports.tagLinkStore.remove(l.uuid));
    exports.tagStore.remove(tagUuid);
}
exports.deleteTag = deleteTag;
// ============================== 练习进度（断点续练） ==============================
function saveProgress(state) {
    exports.practiceStateStore.upsert({ ...state, uuid: state.articleUuid, updatedAt: Date.now() });
}
exports.saveProgress = saveProgress;
function getProgress(articleUuid) {
    return exports.practiceStateStore.find(articleUuid) || null;
}
exports.getProgress = getProgress;
function clearProgress(articleUuid) {
    exports.practiceStateStore.remove(articleUuid);
}
exports.clearProgress = clearProgress;
/** 全部进行中的练习（首页「继续练习」卡片） */
function inProgressStates() {
    return exports.practiceStateStore
        .list()
        .filter((s) => s.status === 'IN_PROGRESS')
        .sort((a, b) => b.lastPracticeTime - a.lastPracticeTime);
}
exports.inProgressStates = inProgressStates;
// ============================== FSRS ==============================
function articleFsrsKey(articleUuid) {
    return articleUuid;
}
exports.articleFsrsKey = articleFsrsKey;
function sentenceFsrsKey(articleUuid, text) {
    return `s:${articleUuid}:${(0, digest_1.hash16)(text)}`;
}
exports.sentenceFsrsKey = sentenceFsrsKey;
function getFsrs(key) {
    const rec = exports.fsrsStore.find(key);
    return rec || null;
}
exports.getFsrs = getFsrs;
function setFsrs(key, state) {
    exports.fsrsStore.upsert({ uuid: key, key, ...state, updatedAt: Date.now() });
}
exports.setFsrs = setFsrs;
function allFsrs() {
    return exports.fsrsStore.list();
}
exports.allFsrs = allFsrs;
// ============================== 自定义挖空 ==============================
function customClozeOfArticle(articleUuid) {
    return (clozesByArticle().get(articleUuid) || []).slice();
}
exports.customClozeOfArticle = customClozeOfArticle;
// ============================== 遮罩配置 ==============================
function maskConfigsOfArticle(articleUuid) {
    return (masksByArticle().get(articleUuid) || []).slice();
}
exports.maskConfigsOfArticle = maskConfigsOfArticle;
function activeMaskConfig(articleUuid) {
    const list = maskConfigsOfArticle(articleUuid);
    return list.find((c) => c.selected) || null;
}
exports.activeMaskConfig = activeMaskConfig;
function selectMaskConfig(articleUuid, configUuid) {
    for (const c of maskConfigsOfArticle(articleUuid)) {
        const selected = c.uuid === configUuid;
        if (c.selected !== selected)
            exports.maskConfigStore.upsert({ ...c, selected, updatedAt: Date.now() });
    }
}
exports.selectMaskConfig = selectMaskConfig;
// ============================== 阅读偏好 ==============================
function getReaderPrefs(articleUuid) {
    const cur = exports.readerPrefsStore.find(articleUuid);
    if (cur)
        return cur;
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
exports.getReaderPrefs = getReaderPrefs;
function saveReaderPrefs(articleUuid, patch) {
    const cur = getReaderPrefs(articleUuid);
    exports.readerPrefsStore.upsert({ ...cur, ...patch, uuid: articleUuid, articleUuid, updatedAt: Date.now() });
}
exports.saveReaderPrefs = saveReaderPrefs;
// ============================== 首页布局 ==============================
function getHomeLayout() {
    const cur = exports.homeLayoutStore.find(HOME_LAYOUT_UUID);
    if (cur && Array.isArray(cur.cards))
        return cur;
    return { uuid: HOME_LAYOUT_UUID, cards: [], updatedAt: 0 };
}
exports.getHomeLayout = getHomeLayout;
function saveHomeLayout(cards) {
    exports.homeLayoutStore.upsert({ uuid: HOME_LAYOUT_UUID, cards, updatedAt: Date.now() });
}
exports.saveHomeLayout = saveHomeLayout;
// ============================== 学习时长统计 ==============================
function ensureStudyStat(date) {
    const cur = exports.studyStatStore.find(date);
    if (cur)
        return cur;
    return { uuid: date, date, practiceSeconds: 0, readingSeconds: 0, practiceCount: 0, updatedAt: 0 };
}
exports.ensureStudyStat = ensureStudyStat;
function addReadingSeconds(seconds, ts = Date.now()) {
    if (seconds <= 0)
        return;
    const stat = ensureStudyStat((0, date_1.dateKey)(ts));
    exports.studyStatStore.upsert({ ...stat, readingSeconds: stat.readingSeconds + Math.round(seconds), updatedAt: Date.now() });
}
exports.addReadingSeconds = addReadingSeconds;
/** 累计学习时长（秒）＝练习时长 + 阅读时长，与统计页口径一致 */
function totalStudySeconds() {
    return exports.studyStatStore.list().reduce((sum, s) => sum + (s.practiceSeconds || 0) + (s.readingSeconds || 0), 0);
}
exports.totalStudySeconds = totalStudySeconds;
function studySecondsBetween(fromDate, toDate) {
    return exports.studyStatStore
        .list()
        .filter((s) => s.date >= fromDate && s.date <= toDate)
        .reduce((sum, s) => sum + (s.practiceSeconds || 0) + (s.readingSeconds || 0), 0);
}
exports.studySecondsBetween = studySecondsBetween;
// ============================== 每日句卡 ==============================
function getSentenceCard(date = (0, date_1.dateKey)()) {
    const cur = exports.sentenceCardStore.find('today');
    if (cur && cur.date === date)
        return cur;
    return null;
}
exports.getSentenceCard = getSentenceCard;
function saveSentenceCard(card) {
    exports.sentenceCardStore.upsert({ ...card, uuid: 'today', updatedAt: Date.now() }, { silent: true });
}
exports.saveSentenceCard = saveSentenceCard;
