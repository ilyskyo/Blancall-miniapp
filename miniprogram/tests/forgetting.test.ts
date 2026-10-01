import test from 'node:test';
import assert from 'node:assert/strict';
import { ForgettingPredictor, Urgency } from '../core/algorithms/forgetting';
import type { ArticleEntity, PracticeRecordEntity } from '../core/algorithms/types';
import type { CardState } from '../core/algorithms/fsrs';
import { ReviewTemplate } from '../core/algorithms/ebbinghaus';

const DAY = 86400000;
const N = 1700000000000;
const INT_MAX = 2147483647;

function article(uuid: string): ArticleEntity {
  return { uuid, title: `标题-${uuid}`, content: '', author: '', autoIndent: false, createdAt: 0, updatedAt: 0 };
}
function rec(articleUuid: string, timestamp: number, correctCount: number, totalBlanks: number): PracticeRecordEntity {
  return {
    uuid: `${articleUuid}-${timestamp}`, articleUuid, mode: 'SENTENCE',
    totalBlanks, correctCount, mistakes: [], timestamp, duration: 0,
    similarity: 0, rating: 0, weakHints: 0, strongHints: 0,
    answeredSentenceStarts: [], mistakeSentenceIndices: [],
  };
}
function fstate(over: Partial<CardState>): CardState {
  return { difficulty: 5, stability: 5, due: 0, lastReview: 0, reviewCount: 0, lapses: 0, lastRating: 0, ...over };
}
function approx(actual: number, expected: number, msg?: string): void {
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} got ${actual}`);
}
function run(articles: ArticleEntity[], records: PracticeRecordEntity[], fsrsStates: Map<string, CardState> = new Map()) {
  return ForgettingPredictor.predict(articles, records, ReviewTemplate.STANDARD, fsrsStates, N);
}

test('predict：无文章返回空数组', () => {
  assert.deepEqual(run([], []), []);
});

test('加权正确率：少于 5 次仍单调递减；超过 5 次只用最近 5 次', () => {
  // WA：3 条记录（最旧→最新 1.0/0.6/0.8）→ 权重 3,2,1（最近权重最大）
  const wa = run(
    [article('WA')],
    [rec('WA', N - 3 * DAY, 10, 10), rec('WA', N - 2 * DAY, 6, 10), rec('WA', N - DAY, 8, 10)],
  )[0];
  approx(wa.lastAccuracy, 0.7666666666666667, 'WA 3 次加权');

  // N6：6 条记录，仅最近 5 次参与
  const n6recs: PracticeRecordEntity[] = [];
  const accs = [1.0, 1.0, 0.9, 0.8, 0.7, 0.6];
  for (let i = 0; i < 6; i++) n6recs.push(rec('N6', N - (5 - i) * DAY, Math.round(accs[i] * 10), 10));
  const n6 = run([article('N6')], n6recs)[0];
  approx(n6.lastAccuracy, 0.7333333333333333, 'N6 6 次仅取最近 5');
});

test('记忆强度：S1=1，S*=S×(1+0.5·acc)，acc<0.3 不增长', () => {
  const wa = run(
    [article('WA')],
    [rec('WA', N - 3 * DAY, 10, 10), rec('WA', N - 2 * DAY, 6, 10), rec('WA', N - DAY, 8, 10)],
  )[0];
  approx(wa.memoryStrength, 1.8199999999999998, 'WA 记忆强度');

  // 第二条 acc=0.2 < 0.3 → 不增长（S 保持 1）
  const low = run([article('L')], [rec('L', N - 2 * DAY, 10, 10), rec('L', N - DAY, 2, 10)])[0];
  approx(low.memoryStrength, 1, 'acc<0.3 不增长');

  const n6recs: PracticeRecordEntity[] = [];
  const accs = [1.0, 1.0, 0.9, 0.8, 0.7, 0.6];
  for (let i = 0; i < 6; i++) n6recs.push(rec('N6', N - (5 - i) * DAY, Math.round(accs[i] * 10), 10));
  const n6 = run([article('N6')], n6recs)[0];
  approx(n6.memoryStrength, 5.3439749999999995, 'N6 记忆强度');
});

test('紧急度分类：NEW / OVERDUE / TODAY / SOON / LATER / MASTERED', () => {
  const recs: PracticeRecordEntity[] = [
    rec('B', N - 10 * DAY, 8, 10),             // 1 次，应复习 = N-9d → OVERDUE(-9)
    rec('D', N - DAY, 10, 10),                  // 应复习 = N → TODAY(0)
    rec('C', N - DAY / 2, 10, 10),              // 应复习 = N+0.5d → SOON(1)
    rec('E', N - 2.05 * DAY, 10, 10), // LATER（3 次，应复习 = N+3.95d）
    rec('E', N - 1.05 * DAY, 10, 10),
    rec('E', N - 0.05 * DAY, 10, 10),
  ];
  for (let i = 0; i < 6; i++) recs.push(rec('F', N - (5 - i) * DAY, 10, 10)); // 6 天 → MASTERED

  const fsrsStates = new Map<string, CardState>([
    ['G', fstate({ reviewCount: 3, due: N + 2 * DAY, stability: 5, lastReview: N - 3 * DAY })],
  ]);

  const byId = new Map(run([article('A'), article('B'), article('C'), article('D'), article('E'), article('F'), article('G')], recs, fsrsStates).map((p) => [p.articleId, p]));

  const a = byId.get('A')!;
  assert.equal(a.urgency, Urgency.NEW);
  assert.equal(a.daysLeft, INT_MAX);
  assert.equal(a.reviewDate, 0);
  assert.equal(a.practiceCount, 0);
  assert.equal(a.lastAccuracy, 0);
  assert.equal(a.retentionRate, 0);
  assert.equal(a.memoryStrength, 0);
  assert.deepEqual(a.decayCurve, []);

  const b = byId.get('B')!;
  assert.equal(b.urgency, Urgency.OVERDUE);
  assert.equal(b.daysLeft, -9);
  approx(b.lastAccuracy, 0.8);
  approx(b.memoryStrength, 1);
  approx(b.retentionRate, 4.5399929762484854e-05, 'B 留存率');

  const d = byId.get('D')!;
  assert.equal(d.urgency, Urgency.TODAY);
  assert.equal(d.daysLeft, 0);
  approx(d.retentionRate, 0.36787944117144233, 'D 留存率');

  const c = byId.get('C')!;
  assert.equal(c.urgency, Urgency.SOON);
  assert.equal(c.daysLeft, 1);
  approx(c.retentionRate, 0.6065306597126334, 'C 留存率');

  const e = byId.get('E')!;
  assert.equal(e.urgency, Urgency.LATER);
  assert.equal(e.daysLeft, 4);
  assert.equal(e.practiceCount, 3);
  approx(e.memoryStrength, 2.25, 'E 记忆强度');
  approx(e.retentionRate, 0.9780228724846005, 'E 留存率');

  const f = byId.get('F')!;
  assert.equal(f.urgency, Urgency.MASTERED);
  assert.equal(f.daysLeft, INT_MAX);
  assert.equal(f.reviewDate, 0);
  assert.equal(f.practiceCount, 6);
  approx(f.memoryStrength, 7.59375, 'F 记忆强度');
  assert.equal(f.decayCurve.length, 31);

  // FSRS 分支：daysLeft 由 due 决定，memoryStrength = stability
  const g = byId.get('G')!;
  assert.equal(g.urgency, Urgency.SOON);
  assert.equal(g.daysLeft, 2);
  assert.equal(g.practiceCount, 3);
  assert.equal(g.memoryStrength, 5);
  approx(g.retentionRate, 0.9311509409583194, 'G FSRS 留存率');
  assert.equal(g.decayCurve.length, 31);
  assert.equal(g.reviewDate, N + 2 * DAY);
});

test('衰减曲线：模板分支 31 点（index0=当前，逐日实时估算）', () => {
  const wa = run(
    [article('WA')],
    [rec('WA', N - 3 * DAY, 10, 10), rec('WA', N - 2 * DAY, 6, 10), rec('WA', N - DAY, 8, 10)],
  )[0];
  assert.equal(wa.decayCurve.length, 31);
  approx(wa.decayCurve[0], 0.5772669028761512, 'decayCurve[0]');
  approx(wa.decayCurve[30], 4.0056814304767635e-08, 'decayCurve[30]');
  // 单调递减
  for (let i = 1; i < wa.decayCurve.length; i++) {
    assert.ok(wa.decayCurve[i] < wa.decayCurve[i - 1], `曲线应单调递减 @${i}`);
  }
});

test('predict 排序：按 urgency.ordinal 升序，同级按 reviewDate 升序', () => {
  const articles = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(article);
  const recs: PracticeRecordEntity[] = [
    rec('B', N - 10 * DAY, 8, 10),
    rec('D', N - DAY, 10, 10),
    rec('C', N - DAY / 2, 10, 10),
    rec('H', N - 0.2 * DAY, 10, 10),
    rec('I', N - 0.1 * DAY, 10, 10),
    rec('J', N - 0.05 * DAY, 10, 10),
    rec('E', N - 2.05 * DAY, 10, 10),
    rec('E', N - 1.05 * DAY, 10, 10),
    rec('E', N - 0.05 * DAY, 10, 10),
  ];
  for (let i = 0; i < 6; i++) recs.push(rec('F', N - (5 - i) * DAY, 10, 10));
  const fsrsStates = new Map<string, CardState>([['G', fstate({ reviewCount: 3, due: N + 2 * DAY, stability: 5, lastReview: N - 3 * DAY })]]);

  const preds = run(articles, recs, fsrsStates);
  assert.deepEqual(preds.map((p) => p.articleId), ['B', 'D', 'C', 'H', 'I', 'J', 'G', 'E', 'A', 'F']);
  // 验证排序键本身
  for (let i = 1; i < preds.length; i++) {
    const prev = preds[i - 1];
    const cur = preds[i];
    assert.ok(
      prev.urgency < cur.urgency || (prev.urgency === cur.urgency && prev.reviewDate <= cur.reviewDate),
      `排序错误 @${i}: ${prev.articleId}(${prev.urgency},${prev.reviewDate}) → ${cur.articleId}(${cur.urgency},${cur.reviewDate})`);
  }
});

test('dueSoon：过滤 逾期+今天+3 天内，调用方再取前 5', () => {
  const articles = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(article);
  const recs: PracticeRecordEntity[] = [
    rec('B', N - 10 * DAY, 8, 10),
    rec('D', N - DAY, 10, 10),
    rec('C', N - DAY / 2, 10, 10),
    rec('H', N - 0.2 * DAY, 10, 10),
    rec('I', N - 0.1 * DAY, 10, 10),
    rec('J', N - 0.05 * DAY, 10, 10),
    rec('E', N - 2.05 * DAY, 10, 10),
    rec('E', N - 1.05 * DAY, 10, 10),
    rec('E', N - 0.05 * DAY, 10, 10),
  ];
  for (let i = 0; i < 6; i++) recs.push(rec('F', N - (5 - i) * DAY, 10, 10));
  const fsrsStates = new Map<string, CardState>([['G', fstate({ reviewCount: 3, due: N + 2 * DAY, stability: 5, lastReview: N - 3 * DAY })]]);

  const preds = run(articles, recs, fsrsStates);
  const due = ForgettingPredictor.dueSoon(preds);
  assert.deepEqual(due.map((p) => p.articleId), ['B', 'D', 'C', 'H', 'I', 'J', 'G']);
  assert.ok(due.every((p) => p.urgency === Urgency.OVERDUE || p.urgency === Urgency.TODAY || p.urgency === Urgency.SOON));
  // 首页卡片口径：调用方取前 5（OverviewScreen 中 dueSoon(predictions).take(5)）
  assert.deepEqual(due.slice(0, 5).map((p) => p.articleId), ['B', 'D', 'C', 'H', 'I']);
});