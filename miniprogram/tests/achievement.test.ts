import test from 'node:test';
import assert from 'node:assert/strict';
import { AchievementManager } from '../core/algorithms/achievement';
import type { PracticeMode, PracticeRecordEntity } from '../core/algorithms/types';

function rec(
  opts: { mode?: PracticeMode; articleUuid?: string; correct?: number; total?: number; duration?: number } = {},
): PracticeRecordEntity {
  const total = opts.total ?? 10;
  return {
    uuid: `r${Math.random()}`, articleUuid: opts.articleUuid ?? 'a', mode: opts.mode ?? 'SENTENCE',
    totalBlanks: total, correctCount: opts.correct ?? total, mistakes: [], timestamp: 0,
    duration: opts.duration ?? 0, similarity: 0, rating: 0, weakHints: 0, strongHints: 0,
    answeredSentenceStarts: [], mistakeSentenceIndices: [],
  };
}

function byId(records: PracticeRecordEntity[], longestStreak: number, currentStreak = 0) {
  const list = AchievementManager.evaluate(records, longestStreak, currentStreak);
  return new Map(list.map((a) => [a.id, a]));
}

const IDS = ['first_practice', 'practice_10', 'practice_100', 'streak_7', 'streak_30', 'streak_100', 'perfect_one', 'perfect_ten', 'all_modes', 'focus_60', 'deep_10'];

test('11 项成就定义与顺序', () => {
  const list = AchievementManager.evaluate([], 0, 0);
  assert.equal(list.length, 11);
  assert.deepEqual(list.map((a) => a.id), IDS);
  assert.deepEqual(list.map((a) => a.title), ['初心', '勤学', '百炼', '连击一周', '连击一月', '百日坚持', '满分时刻', '完美主义', '全才', '专注', '深度钻研']);
});

test('空数据：全部未解锁、进度 0', () => {
  const m = byId([], 0, 0);
  for (const id of IDS) {
    assert.equal(m.get(id)!.unlocked, false, `${id} 应未解锁`);
    assert.equal(m.get(id)!.progress, 0, `${id} 进度应为 0`);
  }
  assert.equal(m.get('first_practice')!.progressText, '0/1 次');
  assert.equal(m.get('streak_7')!.progressText, '0/7 天');
  assert.equal(m.get('focus_60')!.progressText, '0/60 分');
});

test('练习次数：初心 ≥1、勤学 ≥10、百炼 ≥100 的边界', () => {
  assert.equal(byId([rec()], 0).get('first_practice')!.unlocked, true);
  assert.equal(byId([rec()], 0).get('first_practice')!.progress, 1);

  assert.equal(byId(Array.from({ length: 9 }, () => rec()), 0).get('practice_10')!.unlocked, false);
  const ten = byId(Array.from({ length: 10 }, () => rec()), 0).get('practice_10')!;
  assert.equal(ten.unlocked, true);
  assert.equal(ten.progress, 1);
  assert.equal(ten.progressText, '10/10 次');
  // 5 次 → 0.5
  assert.equal(byId(Array.from({ length: 5 }, () => rec()), 0).get('practice_10')!.progress, 0.5);

  assert.equal(byId(Array.from({ length: 99 }, () => rec()), 0).get('practice_100')!.progress, 0.99);
  assert.equal(byId(Array.from({ length: 100 }, () => rec()), 0).get('practice_100')!.unlocked, true);
});

test('连击：longestStreak 7/30/100 边界', () => {
  assert.equal(byId([], 6).get('streak_7')!.unlocked, false);
  assert.equal(byId([], 7).get('streak_7')!.unlocked, true);
  assert.equal(byId([], 29).get('streak_30')!.unlocked, false);
  assert.equal(byId([], 30).get('streak_30')!.unlocked, true);
  assert.equal(byId([], 99).get('streak_100')!.unlocked, false);
  assert.equal(byId([], 100).get('streak_100')!.unlocked, true);
  // 进度与文案
  const s = byId([], 3).get('streak_7')!;
  assert.ok(Math.abs(s.progress - 3 / 7) < 1e-9);
  assert.equal(s.progressText, '3/7 天');
  // currentStreak 不影响判定（仅 longestStreak）
  assert.equal(byId([], 0, 100).get('streak_7')!.unlocked, false);
});

test('满分：totalBlanks>0 且 correct==total 才计入；0/1/10 次边界', () => {
  assert.equal(byId([rec({ correct: 9, total: 10 })], 0).get('perfect_one')!.unlocked, false);
  assert.equal(byId([rec({ correct: 9, total: 10 })], 0).get('perfect_one')!.progress, 0);
  // totalBlanks=0 不算满分
  assert.equal(byId([rec({ correct: 0, total: 0 })], 0).get('perfect_one')!.unlocked, false);
  assert.equal(byId([rec({ correct: 10, total: 10 })], 0).get('perfect_one')!.unlocked, true);
  assert.equal(byId([rec({ correct: 10, total: 10 })], 0).get('perfect_one')!.progressText, '1/1 次');

  const ninePerfect = Array.from({ length: 9 }, () => rec({ correct: 10, total: 10 }));
  assert.equal(byId(ninePerfect, 0).get('perfect_ten')!.unlocked, false);
  assert.equal(byId(ninePerfect, 0).get('perfect_ten')!.progress, 0.9);
  const tenPerfect = Array.from({ length: 10 }, () => rec({ correct: 10, total: 10 }));
  assert.equal(byId(tenPerfect, 0).get('perfect_ten')!.unlocked, true);
});

test('全才：三种练习模式 ≥3 种', () => {
  assert.equal(byId([rec({ mode: 'SENTENCE' }), rec({ mode: 'WORD' })], 0).get('all_modes')!.progress, 2 / 3);
  assert.equal(byId([rec({ mode: 'SENTENCE' }), rec({ mode: 'WORD' })], 0).get('all_modes')!.unlocked, false);
  const three = byId([rec({ mode: 'SENTENCE' }), rec({ mode: 'WORD' }), rec({ mode: 'REVERSE' })], 0).get('all_modes')!;
  assert.equal(three.unlocked, true);
  assert.equal(three.progressText, '3/3 种');
});

test('专注：累计 duration/60000 分钟 ≥60', () => {
  // 3599999ms → 59 分（向零截断）
  assert.equal(byId([rec({ duration: 3599999 })], 0).get('focus_60')!.unlocked, false);
  assert.equal(byId([rec({ duration: 3599999 })], 0).get('focus_60')!.progressText, '59/60 分');
  assert.equal(byId([rec({ duration: 3600000 })], 0).get('focus_60')!.unlocked, true);
  // 30 分钟 → 0.5
  assert.equal(byId([rec({ duration: 1800000 })], 0).get('focus_60')!.progress, 0.5);
  // 多条累加
  const sum = byId([rec({ duration: 1000000 }), rec({ duration: 1000000 }), rec({ duration: 1600000 })], 0).get('focus_60')!;
  assert.equal(sum.progressText, '60/60 分');
  assert.equal(sum.unlocked, true);
});

test('深度钻研：单篇练习次数 ≥10', () => {
  // 分散到 9 篇文章，每篇 1 次 → max=1
  const spread = Array.from({ length: 9 }, (_v, i) => rec({ articleUuid: `a${i}` }));
  assert.equal(byId(spread, 0).get('deep_10')!.progress, 0.1);
  // 单篇 9 次 → 未解锁
  const nine = Array.from({ length: 9 }, () => rec({ articleUuid: 'same' }));
  assert.equal(byId(nine, 0).get('deep_10')!.unlocked, false);
  assert.equal(byId(nine, 0).get('deep_10')!.progress, 0.9);
  // 单篇 10 次 → 解锁
  const ten = Array.from({ length: 10 }, () => rec({ articleUuid: 'same' }));
  const a = byId(ten, 0).get('deep_10')!;
  assert.equal(a.unlocked, true);
  assert.equal(a.progress, 1);
  assert.equal(a.progressText, '10/10 次');
});