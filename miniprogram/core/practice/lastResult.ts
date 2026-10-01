/**
 * 练习结果交接（练习页 → 结果页）
 * 不落盘（避免污染存储），仅在同一次导航生命周期内使用。
 */

import { Judgment, PracticeSession } from './session';
import { PracticeRecordEntity } from '../algorithms/types';

interface LastResult {
  recordUuid: string;
  judgment: Judgment;
  session: PracticeSession;
  articleTitle: string;
  /** 是否部分提交（未完成批改） */
  partial: boolean;
}

let last: LastResult | null = null;

export function setLastResult(result: LastResult): void {
  last = result;
}

export function takeLastResult(): LastResult | null {
  const cur = last;
  last = null;
  return cur;
}

export function peekLastResult(): LastResult | null {
  return last;
}

/** 结果页用：可读的错误类型文案 */
export function errorTypeText(errorType: string): string {
  switch (errorType) {
    case 'TYPO':
      return '错别字';
    case 'MISSING':
      return '漏字';
    case 'EXTRA':
      return '多填';
    case 'WRONG_ORDER':
      return '顺序错';
    default:
      return '未正确';
  }
}

export type { PracticeRecordEntity };