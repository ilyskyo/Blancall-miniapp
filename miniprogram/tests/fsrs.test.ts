import test from 'node:test';
import assert from 'node:assert/strict';
import { FsrsEngine, Rating } from '../core/algorithms/fsrs';
import type { CardState } from '../core/algorithms/fsrs';

const DAY = 86400000;
const T0 = 1700000000000;
const INT_MAX = 2147483647;

/** 期望值由 Python 独立复刻 FSRS-6 公式生成（见报告说明） */
function approx(actual: number, expected: number, msg?: string): void {
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} got ${actual} (diff ${actual - expected})`);
}

function fresh(): CardState {
  return { difficulty: 0, stability: 0, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0 };
}
function state(over: Partial<CardState>): CardState {
  return { ...fresh(), ...over };
}

/** 与实现同口径复算 raw interval（requestRetention=0.9 时 I(S)≈S） */
function rawInterval(stability: number): number {
  const w20 = FsrsEngine.DEFAULT_PARAMS[20];
  const decay = -w20;
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return stability / factor * (Math.pow(FsrsEngine.DEFAULT_REQUEST_RETENTION, 1 / decay) - 1);
}

/** applyFuzz 的合法区间（>=2.5 天生效） */
function fuzzBounds(raw: number): [number, number] {
  const ivl = Math.round(raw);
  return [Math.max(2, Math.round(ivl * 0.95 - 1)), Math.round(ivl * 1.05 + 1)];
}

test('DEFAULT_PARAMS 为 FSRS-6 官方 21 个权重（逐位一致）', () => {
  assert.deepEqual(FsrsEngine.DEFAULT_PARAMS, [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ]);
  assert.equal(FsrsEngine.DEFAULT_REQUEST_RETENTION, 0.9);
  assert.equal(Rating.AGAIN, 1);
  assert.equal(Rating.HARD, 2);
  assert.equal(Rating.GOOD, 3);
  assert.equal(Rating.EASY, 4);
  assert.equal(FsrsEngine.Rating.GOOD, Rating.GOOD);
});

test('首次评级：初始难度/稳定性公式', () => {
  const s = FsrsEngine.review(fresh(), Rating.GOOD, T0);
  approx(s.stability, 2.3065, 'initStability(GOOD)=w[2]');
  approx(s.difficulty, 2.118103970459015, 'initDifficulty(GOOD)');
  assert.equal(s.reviewCount, 1);
  assert.equal(s.lapses, 0);
  assert.equal(s.lastReview, T0);
  // raw=2.3065 < 2.5 → 无 fuzz，round(2.3065)=2
  assert.equal(s.due, T0 + 2 * DAY);

  const again = FsrsEngine.review(fresh(), Rating.AGAIN, T0);
  approx(again.stability, 0.212, 'initStability(AGAIN)=w[0]');
  approx(again.difficulty, 6.4133, 'initDifficulty(AGAIN)');
  // raw=0.212 → round=0 → coerceIn(1, MAX)=1
  assert.equal(again.due, T0 + DAY);
  assert.equal(again.lapses, 1);
});

test('固定评级序列 GOOD/GOOD/AGAIN/HARD/EASY 的 difficulty/stability 数值', () => {
  const s1 = FsrsEngine.review(fresh(), Rating.GOOD, T0);
  const s2 = FsrsEngine.review(s1, Rating.GOOD, T0 + 3 * DAY);
  const s3 = FsrsEngine.review(s2, Rating.AGAIN, T0 + 5 * DAY);
  const s4 = FsrsEngine.review(s3, Rating.HARD, T0 + 6 * DAY);
  const s5 = FsrsEngine.review(s4, Rating.EASY, T0 + 10 * DAY);

  approx(s2.difficulty, 2.1169858664885557, 's2.difficulty');
  approx(s2.stability, 13.826903694354572, 's2.stability');
  approx(s3.difficulty, 7.399906858810896, 's3.difficulty');
  approx(s3.stability, 1.511297407250357, 's3.stability');
  approx(s4.difficulty, 8.264937008538293, 's4.difficulty');
  approx(s4.stability, 2.719760235883209, 's4.stability');
  approx(s5.difficulty, 7.676159810727193, 's5.difficulty');
  approx(s5.stability, 10.985808856648383, 's5.stability');

  assert.deepEqual(
    [s1.reviewCount, s2.reviewCount, s3.reviewCount, s4.reviewCount, s5.reviewCount],
    [1, 2, 3, 4, 5]);
  assert.deepEqual(
    [s1.lapses, s2.lapses, s3.lapses, s4.lapses, s5.lapses],
    [0, 0, 1, 1, 1]);
});

test('间隔：raw<2.5 无 fuzz（确定性），raw>=2.5 落在 ±5%（实现区间）内', () => {
  // raw < 2.5：50 次结果完全一致（2.3065 → 2 天）
  for (let i = 0; i < 50; i++) {
    assert.equal(FsrsEngine.review(fresh(), Rating.GOOD, T0).due, T0 + 2 * DAY);
  }
  // AGAIN s3 raw=1.511297407250357 < 2.5 → round=2
  const s2 = FsrsEngine.review(FsrsEngine.review(fresh(), Rating.GOOD, T0), Rating.GOOD, T0 + 3 * DAY);
  const s3 = FsrsEngine.review(s2, Rating.AGAIN, T0 + 5 * DAY);
  assert.equal(s3.due - (T0 + 5 * DAY), 2 * DAY);

  // raw >= 2.5：HARD（raw≈2.7198）与 EASY（raw≈10.9858）多次采样均落在实现区间
  const [loH, hiH] = fuzzBounds(rawInterval(2.719760235883209));
  const [loE, hiE] = fuzzBounds(rawInterval(10.985808856648383));
  const seenH = new Set<number>();
  const seenE = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const a = FsrsEngine.review(state({ difficulty: 7.399906858810896, stability: 1.511297407250357, due: T0 + 10 * DAY, lastReview: T0 + 5 * DAY, reviewCount: 3, lapses: 1, lastRating: 1 }), Rating.HARD, T0 + 6 * DAY);
    const dH = (a.due - (T0 + 6 * DAY)) / DAY;
    approx(a.stability, 2.719760235883209, 'HARD stability');
    assert.ok(dH >= loH && dH <= hiH, `HARD fuzz ${dH} not in [${loH},${hiH}]`);
    seenH.add(dH);

    const b = FsrsEngine.review(state({ difficulty: 8.264937008538293, stability: 2.719760235883209, due: T0 + 11 * DAY, lastReview: T0 + 6 * DAY, reviewCount: 4, lapses: 1, lastRating: 2 }), Rating.EASY, T0 + 10 * DAY);
    const dE = (b.due - (T0 + 10 * DAY)) / DAY;
    approx(b.stability, 10.985808856648383, 'EASY stability');
    assert.ok(dE >= loE && dE <= hiE, `EASY fuzz ${dE} not in [${loE},${hiE}]`);
    seenE.add(dE);
  }
  // 随机确实生效（区间内出现多个取值）
  assert.ok(seenH.size > 1, 'HARD fuzz 应产生随机分布');
  assert.ok(seenE.size > 1, 'EASY fuzz 应产生随机分布');
});

test('间隔上下限：MIN_STABILITY 与 MAX_INTERVAL_DAYS=36500', () => {
  // 极大稳定性 → clamp 到 36500 天
  const big = FsrsEngine.review(
    state({ difficulty: 5, stability: 1e9, due: T0 - DAY, lastReview: T0 - 100 * DAY, reviewCount: 5, lapses: 0, lastRating: 3 }),
    Rating.GOOD, T0);
  assert.equal(big.due - T0, 36500 * DAY);

  // 遗忘分支下限：稳定性不低 MIN_STABILITY，间隔至少 1 天
  const low = FsrsEngine.review(
    state({ difficulty: 9, stability: 0.2, due: T0 - DAY, lastReview: T0 - DAY, reviewCount: 2, lapses: 1, lastRating: 1 }),
    Rating.AGAIN, T0);
  assert.ok(low.stability >= 0.1);
  assert.ok(low.due - T0 >= DAY);
});

test('同日复习：走 FSRS-6 同日公式（不推进间隔）', () => {
  // 同一日历日、未到期 → S\' = S·e^(w17(G-3+w18))·S^(-w19)
  const base = state({ difficulty: 5, stability: 10, due: T0 + 30 * DAY, lastReview: T0, reviewCount: 3, lapses: 0, lastRating: 3 });
  const s = FsrsEngine.review(base, Rating.GOOD, T0 + 3600000);
  approx(s.stability, 9.029987596817193, 'same-day stability');
  approx(s.difficulty, 4.996, 'same-day difficulty');
  assert.equal(s.reviewCount, 4);
});

test('retentionRate：Δt=0 → 1，Δt=S → 0.9；stability<=0 → 0', () => {
  const st = state({ difficulty: 2.118, stability: 2.3065, due: 0, lastReview: T0, reviewCount: 1, lapses: 0, lastRating: 3 });
  assert.equal(FsrsEngine.retentionRate(st, T0), 1);
  approx(FsrsEngine.retentionRate(st, T0 + 2.3065 * DAY), 0.9, 'R(Δt=S)');
  approx(FsrsEngine.retentionRate(st, T0 + DAY), 0.9468474993825461, 'R(Δt=1), S=2.3065');
  assert.equal(FsrsEngine.retentionRate(fresh(), T0), 0);
});

test('daysUntilDue / isDue 边界', () => {
  assert.equal(FsrsEngine.daysUntilDue(fresh(), T0), INT_MAX);
  assert.equal(FsrsEngine.isDue(fresh(), T0 + 999 * DAY), false);

  const st = state({ difficulty: 5, stability: 1, due: T0, lastReview: T0 - DAY, reviewCount: 1, lapses: 0, lastRating: 3 });
  assert.equal(FsrsEngine.daysUntilDue(st, T0), 0, '恰好到期 → 0');
  assert.equal(FsrsEngine.daysUntilDue(st, T0 + 1), 0, '逾期不足 1 天 → 0（ceil 归一）');
  assert.equal(FsrsEngine.daysUntilDue(st, T0 - 1), 1, '距到期 1ms → 1');
  assert.equal(FsrsEngine.daysUntilDue(st, T0 - DAY), 1, '整整 1 天 → 1');
  assert.equal(FsrsEngine.daysUntilDue(st, T0 - 2 * DAY), 2);
  assert.equal(FsrsEngine.daysUntilDue(st, T0 + DAY), -1, '逾期 1 天 → -1');
  assert.equal(FsrsEngine.daysUntilDue(st, T0 + DAY + 1), -1, '逾期 1 天多 → -1');

  assert.equal(FsrsEngine.isDue(st, T0 - 1), false);
  assert.equal(FsrsEngine.isDue(st, T0), true);
  assert.equal(FsrsEngine.isDue(st, T0 + 1), true);
});

test('评级映射：正确率与相似度阈值', () => {
  assert.equal(FsrsEngine.ratingFromAccuracy(0.39), Rating.AGAIN);
  assert.equal(FsrsEngine.ratingFromAccuracy(0.4), Rating.HARD);
  assert.equal(FsrsEngine.ratingFromAccuracy(0.69), Rating.HARD);
  assert.equal(FsrsEngine.ratingFromAccuracy(0.7), Rating.GOOD);
  assert.equal(FsrsEngine.ratingFromAccuracy(0.89), Rating.GOOD);
  assert.equal(FsrsEngine.ratingFromAccuracy(0.9), Rating.EASY);

  assert.equal(FsrsEngine.gradeFromSimilarity(0.59), Rating.AGAIN);
  assert.equal(FsrsEngine.gradeFromSimilarity(0.6), Rating.HARD);
  assert.equal(FsrsEngine.gradeFromSimilarity(0.84), Rating.HARD);
  assert.equal(FsrsEngine.gradeFromSimilarity(0.85), Rating.GOOD);
  assert.equal(FsrsEngine.gradeFromSimilarity(0.96), Rating.GOOD);
  assert.equal(FsrsEngine.gradeFromSimilarity(0.97), Rating.EASY);
});

test('retentionForTemplate：sprint/deep/其他', () => {
  assert.equal(FsrsEngine.retentionForTemplate('sprint'), 0.85);
  assert.equal(FsrsEngine.retentionForTemplate('deep'), 0.95);
  assert.equal(FsrsEngine.retentionForTemplate('standard'), 0.9);
  assert.equal(FsrsEngine.retentionForTemplate('unknown'), 0.9);
});

test('configure：合法参数生效并 clamp retention，非法参数忽略', () => {
  const w = FsrsEngine.DEFAULT_PARAMS.slice();
  try {
    // 非法参数（长度不是 21）被忽略 → 仍用默认 0.9（RAW=S → 2 天）
    FsrsEngine.configure([1, 2, 3], 0.5);
    assert.equal(FsrsEngine.review(fresh(), Rating.GOOD, T0).due, T0 + 2 * DAY, '非法参数应被忽略');

    // retention 上界 clamp 到 0.99：目标留存率越高 → 间隔越短
    FsrsEngine.configure(w, 5);
    assert.equal(FsrsEngine.review(fresh(), Rating.GOOD, T0).due, T0 + DAY, 'retention clamp 到 0.99');

    // retention 下界 clamp 到 0.01：目标留存率极低 → 间隔拉到最大 36500 天
    FsrsEngine.configure(w, 0.0001);
    assert.equal(FsrsEngine.review(fresh(), Rating.GOOD, T0).due, T0 + 36500 * DAY, 'retention clamp 到 0.01');

    // w[20] <= 0 视为非法，忽略
    const bad = w.slice();
    bad[20] = 0;
    FsrsEngine.configure(bad, 0.5);
    assert.equal(FsrsEngine.review(fresh(), Rating.GOOD, T0).due, T0 + 36500 * DAY, '非法 w[20] 被忽略（沿用上次有效配置）');
  } finally {
    FsrsEngine.configure(FsrsEngine.DEFAULT_PARAMS.slice(), FsrsEngine.DEFAULT_REQUEST_RETENTION);
  }
  assert.equal(FsrsEngine.review(fresh(), Rating.GOOD, T0).due, T0 + 2 * DAY, '重置回默认');
});