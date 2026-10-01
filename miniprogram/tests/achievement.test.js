"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const achievement_1 = require("../core/algorithms/achievement");
function rec(opts = {}) {
    var _a, _b, _c, _d, _e;
    const total = (_a = opts.total) !== null && _a !== void 0 ? _a : 10;
    return {
        uuid: `r${Math.random()}`, articleUuid: (_b = opts.articleUuid) !== null && _b !== void 0 ? _b : 'a', mode: (_c = opts.mode) !== null && _c !== void 0 ? _c : 'SENTENCE',
        totalBlanks: total, correctCount: (_d = opts.correct) !== null && _d !== void 0 ? _d : total, mistakes: [], timestamp: 0,
        duration: (_e = opts.duration) !== null && _e !== void 0 ? _e : 0, similarity: 0, rating: 0, weakHints: 0, strongHints: 0,
        answeredSentenceStarts: [], mistakeSentenceIndices: [],
    };
}
function byId(records, longestStreak, currentStreak = 0) {
    const list = achievement_1.AchievementManager.evaluate(records, longestStreak, currentStreak);
    return new Map(list.map((a) => [a.id, a]));
}
const IDS = ['first_practice', 'practice_10', 'practice_100', 'streak_7', 'streak_30', 'streak_100', 'perfect_one', 'perfect_ten', 'all_modes', 'focus_60', 'deep_10'];
(0, node_test_1.default)('11 项成就定义与顺序', () => {
    const list = achievement_1.AchievementManager.evaluate([], 0, 0);
    strict_1.default.equal(list.length, 11);
    strict_1.default.deepEqual(list.map((a) => a.id), IDS);
    strict_1.default.deepEqual(list.map((a) => a.title), ['初心', '勤学', '百炼', '连击一周', '连击一月', '百日坚持', '满分时刻', '完美主义', '全才', '专注', '深度钻研']);
});
(0, node_test_1.default)('空数据：全部未解锁、进度 0', () => {
    const m = byId([], 0, 0);
    for (const id of IDS) {
        strict_1.default.equal(m.get(id).unlocked, false, `${id} 应未解锁`);
        strict_1.default.equal(m.get(id).progress, 0, `${id} 进度应为 0`);
    }
    strict_1.default.equal(m.get('first_practice').progressText, '0/1 次');
    strict_1.default.equal(m.get('streak_7').progressText, '0/7 天');
    strict_1.default.equal(m.get('focus_60').progressText, '0/60 分');
});
(0, node_test_1.default)('练习次数：初心 ≥1、勤学 ≥10、百炼 ≥100 的边界', () => {
    strict_1.default.equal(byId([rec()], 0).get('first_practice').unlocked, true);
    strict_1.default.equal(byId([rec()], 0).get('first_practice').progress, 1);
    strict_1.default.equal(byId(Array.from({ length: 9 }, () => rec()), 0).get('practice_10').unlocked, false);
    const ten = byId(Array.from({ length: 10 }, () => rec()), 0).get('practice_10');
    strict_1.default.equal(ten.unlocked, true);
    strict_1.default.equal(ten.progress, 1);
    strict_1.default.equal(ten.progressText, '10/10 次');
    // 5 次 → 0.5
    strict_1.default.equal(byId(Array.from({ length: 5 }, () => rec()), 0).get('practice_10').progress, 0.5);
    strict_1.default.equal(byId(Array.from({ length: 99 }, () => rec()), 0).get('practice_100').progress, 0.99);
    strict_1.default.equal(byId(Array.from({ length: 100 }, () => rec()), 0).get('practice_100').unlocked, true);
});
(0, node_test_1.default)('连击：longestStreak 7/30/100 边界', () => {
    strict_1.default.equal(byId([], 6).get('streak_7').unlocked, false);
    strict_1.default.equal(byId([], 7).get('streak_7').unlocked, true);
    strict_1.default.equal(byId([], 29).get('streak_30').unlocked, false);
    strict_1.default.equal(byId([], 30).get('streak_30').unlocked, true);
    strict_1.default.equal(byId([], 99).get('streak_100').unlocked, false);
    strict_1.default.equal(byId([], 100).get('streak_100').unlocked, true);
    // 进度与文案
    const s = byId([], 3).get('streak_7');
    strict_1.default.ok(Math.abs(s.progress - 3 / 7) < 1e-9);
    strict_1.default.equal(s.progressText, '3/7 天');
    // currentStreak 不影响判定（仅 longestStreak）
    strict_1.default.equal(byId([], 0, 100).get('streak_7').unlocked, false);
});
(0, node_test_1.default)('满分：totalBlanks>0 且 correct==total 才计入；0/1/10 次边界', () => {
    strict_1.default.equal(byId([rec({ correct: 9, total: 10 })], 0).get('perfect_one').unlocked, false);
    strict_1.default.equal(byId([rec({ correct: 9, total: 10 })], 0).get('perfect_one').progress, 0);
    // totalBlanks=0 不算满分
    strict_1.default.equal(byId([rec({ correct: 0, total: 0 })], 0).get('perfect_one').unlocked, false);
    strict_1.default.equal(byId([rec({ correct: 10, total: 10 })], 0).get('perfect_one').unlocked, true);
    strict_1.default.equal(byId([rec({ correct: 10, total: 10 })], 0).get('perfect_one').progressText, '1/1 次');
    const ninePerfect = Array.from({ length: 9 }, () => rec({ correct: 10, total: 10 }));
    strict_1.default.equal(byId(ninePerfect, 0).get('perfect_ten').unlocked, false);
    strict_1.default.equal(byId(ninePerfect, 0).get('perfect_ten').progress, 0.9);
    const tenPerfect = Array.from({ length: 10 }, () => rec({ correct: 10, total: 10 }));
    strict_1.default.equal(byId(tenPerfect, 0).get('perfect_ten').unlocked, true);
});
(0, node_test_1.default)('全才：三种练习模式 ≥3 种', () => {
    strict_1.default.equal(byId([rec({ mode: 'SENTENCE' }), rec({ mode: 'WORD' })], 0).get('all_modes').progress, 2 / 3);
    strict_1.default.equal(byId([rec({ mode: 'SENTENCE' }), rec({ mode: 'WORD' })], 0).get('all_modes').unlocked, false);
    const three = byId([rec({ mode: 'SENTENCE' }), rec({ mode: 'WORD' }), rec({ mode: 'REVERSE' })], 0).get('all_modes');
    strict_1.default.equal(three.unlocked, true);
    strict_1.default.equal(three.progressText, '3/3 种');
});
(0, node_test_1.default)('专注：累计 duration/60000 分钟 ≥60', () => {
    // 3599999ms → 59 分（向零截断）
    strict_1.default.equal(byId([rec({ duration: 3599999 })], 0).get('focus_60').unlocked, false);
    strict_1.default.equal(byId([rec({ duration: 3599999 })], 0).get('focus_60').progressText, '59/60 分');
    strict_1.default.equal(byId([rec({ duration: 3600000 })], 0).get('focus_60').unlocked, true);
    // 30 分钟 → 0.5
    strict_1.default.equal(byId([rec({ duration: 1800000 })], 0).get('focus_60').progress, 0.5);
    // 多条累加
    const sum = byId([rec({ duration: 1000000 }), rec({ duration: 1000000 }), rec({ duration: 1600000 })], 0).get('focus_60');
    strict_1.default.equal(sum.progressText, '60/60 分');
    strict_1.default.equal(sum.unlocked, true);
});
(0, node_test_1.default)('深度钻研：单篇练习次数 ≥10', () => {
    // 分散到 9 篇文章，每篇 1 次 → max=1
    const spread = Array.from({ length: 9 }, (_v, i) => rec({ articleUuid: `a${i}` }));
    strict_1.default.equal(byId(spread, 0).get('deep_10').progress, 0.1);
    // 单篇 9 次 → 未解锁
    const nine = Array.from({ length: 9 }, () => rec({ articleUuid: 'same' }));
    strict_1.default.equal(byId(nine, 0).get('deep_10').unlocked, false);
    strict_1.default.equal(byId(nine, 0).get('deep_10').progress, 0.9);
    // 单篇 10 次 → 解锁
    const ten = Array.from({ length: 10 }, () => rec({ articleUuid: 'same' }));
    const a = byId(ten, 0).get('deep_10');
    strict_1.default.equal(a.unlocked, true);
    strict_1.default.equal(a.progress, 1);
    strict_1.default.equal(a.progressText, '10/10 次');
});
