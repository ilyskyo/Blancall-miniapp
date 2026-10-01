import test from 'node:test';
import assert from 'node:assert/strict';
import { EbbinghausScheduler, ReviewTemplate } from '../core/algorithms/ebbinghaus';
import type { PracticeRecordEntity } from '../core/algorithms/types';
import type { CardState } from '../core/algorithms/fsrs';

const DAY = 86400000;
// 本地时间正午（中国无夏令时，日历日推进 = +interval 天）
const T_LAST = new Date(2024, 0, 15, 12, 0, 0).getTime();

function rec(timestamp: number, correctCount: number, totalBlanks: number): PracticeRecordEntity {
  return {
    uuid: `r${timestamp}`, articleUuid: 'art', mode: 'SENTENCE',
    totalBlanks, correctCount, mistakes: [], timestamp, duration: 0,
    similarity: 0, rating: 0, weakHints: 0, strongHints: 0,
    answeredSentenceStarts: [], mistakeSentenceIndices: [],
  };
}

function fsrs(over: Partial<CardState>): CardState {
  return { difficulty: 5, stability: 10, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0, ...over };
}

test('预设模板定义（冲刺/标准/深度）', () => {
  assert.deepEqual(ReviewTemplate.SPRINT, { id: 'sprint', name: '冲刺备考', intervals: [1, 1, 2, 3, 5, 7], autoAdjust: true, isPreset: true });
  assert.deepEqual(ReviewTemplate.STANDARD, { id: 'standard', name: '标准记忆', intervals: [1, 2, 4, 7, 15, 30], autoAdjust: false, isPreset: true });
  assert.deepEqual(ReviewTemplate.DEEP, { id: 'deep', name: '深度长期', intervals: [1, 2, 4, 7, 15, 30, 60, 90], autoAdjust: false, isPreset: true });
  assert.deepEqual(ReviewTemplate.PRESETS.map((t) => t.id), ['sprint', 'standard', 'deep']);
});

test('nextReviewTime：标准模板首轮/后续/完成后', () => {
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 0, T_LAST), T_LAST + 1 * DAY);
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 1, T_LAST), T_LAST + 2 * DAY);
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 2, T_LAST), T_LAST + 4 * DAY);
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 5, T_LAST), T_LAST + 30 * DAY);
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 6, T_LAST), null);
  // 本地日历日推进正确
  const next = EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 0, T_LAST)!;
  assert.equal(new Date(next).getDate(), 16);
});

test('nextReviewTime：深度模板首尾', () => {
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.DEEP, 0, T_LAST), T_LAST + 1 * DAY);
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.DEEP, 7, T_LAST), T_LAST + 90 * DAY);
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.DEEP, 8, T_LAST), null);
});

test('自适应微调：冲刺模板四档系数（×0.5 / ×0.75 / ×1.15 / ×1.3）', () => {
  const ns = (studyCount: number, acc: number): number | null =>
    EbbinghausScheduler.nextReviewTime(ReviewTemplate.SPRINT, studyCount, T_LAST, acc);

  // studyCount=0：不参与微调（interval=1）
  for (const acc of [0.3, 0.5, 0.85, 0.9, 0.95, 0.97, 1.0]) {
    assert.equal(ns(0, acc), T_LAST + 1 * DAY, `sc0 acc=${acc}`);
  }
  // studyCount=1（interval=1）：低正确率保持 1，高正确率 → 2
  assert.equal(ns(1, 0.3), T_LAST + 1 * DAY);
  assert.equal(ns(1, 0.5), T_LAST + 1 * DAY);
  assert.equal(ns(1, 0.85), T_LAST + 1 * DAY);
  assert.equal(ns(1, 0.9), T_LAST + 2 * DAY);
  assert.equal(ns(1, 0.95), T_LAST + 2 * DAY);
  assert.equal(ns(1, 0.97), T_LAST + 2 * DAY);
  // studyCount=3（interval=3）
  assert.equal(ns(3, 0.3), T_LAST + 1 * DAY);   // max(1, int(3*0.5)=1)
  assert.equal(ns(3, 0.5), T_LAST + 2 * DAY);   // max(1, int(3*0.75)=2)
  assert.equal(ns(3, 0.85), T_LAST + 3 * DAY);  // 0.85 不命中任何档 → 原值
  assert.equal(ns(3, 0.9), T_LAST + 3 * DAY);   // int(3*1.15)=3
  assert.equal(ns(3, 0.95), T_LAST + 3 * DAY);  // 0.95 非 >0.95 → 走 ×1.15
  assert.equal(ns(3, 0.97), T_LAST + 3 * DAY);  // int(3*1.3)=3
  // studyCount=4（interval=5）
  assert.equal(ns(4, 0.3), T_LAST + 2 * DAY);
  assert.equal(ns(4, 0.5), T_LAST + 3 * DAY);
  assert.equal(ns(4, 0.85), T_LAST + 5 * DAY);
  assert.equal(ns(4, 0.9), T_LAST + 5 * DAY);
  assert.equal(ns(4, 0.97), T_LAST + 6 * DAY);
  // studyCount=5（interval=7）
  assert.equal(ns(5, 0.3), T_LAST + 3 * DAY);
  assert.equal(ns(5, 0.5), T_LAST + 5 * DAY);
  assert.equal(ns(5, 0.9), T_LAST + 8 * DAY);
  assert.equal(ns(5, 0.97), T_LAST + 9 * DAY);

  // 标准模板 autoAdjust=false → 不微调
  assert.equal(EbbinghausScheduler.nextReviewTime(ReviewTemplate.STANDARD, 1, T_LAST, 0.1), T_LAST + 2 * DAY);
});

test('isDue：完成轮次/首个间隔/自适应', () => {
  const r1 = [rec(T_LAST, 8, 10)];
  assert.equal(EbbinghausScheduler.isDue(ReviewTemplate.STANDARD, [], () => T_LAST + 100 * DAY), false);
  assert.equal(EbbinghausScheduler.isDue(ReviewTemplate.STANDARD, r1, () => T_LAST + DAY - 1), false);
  assert.equal(EbbinghausScheduler.isDue(ReviewTemplate.STANDARD, r1, () => T_LAST + DAY), true);

  // 达到轮次总数 → 不再 due
  const six: PracticeRecordEntity[] = [];
  for (let i = 0; i < 6; i++) six.push(rec(T_LAST - i * DAY, 10, 10));
  assert.equal(EbbinghausScheduler.isDue(ReviewTemplate.STANDARD, six, () => T_LAST + 999 * DAY), false);

  // 冲刺自适应：2 条记录且最近一次满分 → 间隔 2 天
  const sprintRecs = [rec(T_LAST - DAY, 5, 10), rec(T_LAST, 10, 10)];
  assert.equal(EbbinghausScheduler.isDue(ReviewTemplate.SPRINT, sprintRecs, () => T_LAST + DAY), false);
  assert.equal(EbbinghausScheduler.isDue(ReviewTemplate.SPRINT, sprintRecs, () => T_LAST + 2 * DAY), true);
});

test('getReviewStatus：NOT_STARTED / DUE / PENDING / COMPLETED', () => {
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, [], () => T_LAST), { type: 'NOT_STARTED' });

  const r1 = [rec(T_LAST, 8, 10)];
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, r1, () => T_LAST), { type: 'PENDING', daysLeft: 1 });
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, r1, () => T_LAST + DAY / 2), { type: 'PENDING', daysLeft: 1 });
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, r1, () => T_LAST - 1), { type: 'PENDING', daysLeft: 2 });
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, r1, () => T_LAST + DAY), { type: 'DUE' });
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, r1, () => T_LAST + 3 * DAY), { type: 'DUE' });

  const six: PracticeRecordEntity[] = [];
  for (let i = 0; i < 6; i++) six.push(rec(T_LAST - i * DAY, 10, 10));
  assert.deepEqual(EbbinghausScheduler.getReviewStatus(ReviewTemplate.STANDARD, six, () => T_LAST), { type: 'COMPLETED' });
});

test('getReviewStatusByFsrs：FSRS 优先，无状态时回退模板', () => {
  const records = [rec(T_LAST, 8, 10)];
  // reviewCount=0 → 回退模板口径
  assert.deepEqual(
    EbbinghausScheduler.getReviewStatusByFsrs(fsrs({ reviewCount: 0, due: T_LAST + 999 * DAY }), records, ReviewTemplate.STANDARD, () => T_LAST),
    { type: 'PENDING', daysLeft: 1 });
  // reviewCount>0 → 完全按 FSRS due 判定
  assert.deepEqual(
    EbbinghausScheduler.getReviewStatusByFsrs(fsrs({ reviewCount: 2, due: T_LAST }), records, ReviewTemplate.STANDARD, () => T_LAST - 1),
    { type: 'PENDING', daysLeft: 1 });
  assert.deepEqual(
    EbbinghausScheduler.getReviewStatusByFsrs(fsrs({ reviewCount: 2, due: T_LAST }), records, ReviewTemplate.STANDARD, () => T_LAST + 1),
    { type: 'DUE' });
  // null 状态 → 回退模板
  assert.deepEqual(
    EbbinghausScheduler.getReviewStatusByFsrs(null, records, ReviewTemplate.STANDARD, () => T_LAST + DAY),
    { type: 'DUE' });
});