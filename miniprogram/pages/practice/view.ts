/**
 * 练习页视图模型（把 PracticeSession 转成 WXML 可渲染结构）
 * WXML 不支持函数调用与复杂表达式，因此所有派生数据都在这里算好。
 */

import { PracticeSession } from '../../core/practice/session';
import { PracticeMode } from '../../core/algorithms/types';

export interface BlankView {
  /** 空序号 */
  index: number;
  /** 已输入内容 */
  value: string;
  /** 宽度（rpx），按答案长度估算 */
  width: number;
  /** 提示字（弱提示淡显；空字符串表示无） */
  hint: string;
  /** 批改后状态：correct / wrong / none */
  state: 'correct' | 'wrong' | 'none';
  /** 批改后正确答案（wrong 时展示） */
  answer: string;
  /** 是否正确（批改后） */
  correct: boolean;
}

export interface SegmentView {
  /** 文本片段 */
  text: string;
  /** 该片段后紧跟的空（null = 结尾无空） */
  blank: BlankView | null;
}

export interface ViewModel {
  segments: SegmentView[];
  answered: number;
  total: number;
  progressPercent: number;
  modeLabel: string;
  showHintGhost: boolean;
}

export const MODE_LABEL: Record<PracticeMode, string> = {
  SENTENCE: '句子挖空',
  WORD: '字词挖空',
  REVERSE: '反向默写',
};

function blankWidth(answer: string): number {
  const n = Math.max(2, Math.min(8, answer.length));
  return n * 38 + 24;
}

/**
 * 生成视图模型
 * @param judged 批改后的逐空判定（key = 空序号），未批改传 null
 * @param hintBlank 当前提示的空序号
 * @param hintChar 提示字
 */
export function buildViewModel(
  session: PracticeSession,
  judged: Record<number, { result: string }> | null,
  hintBlank: number | null,
  hintChar: string
): ViewModel {
  const parts = session.displayText.split('___');
  const segments: SegmentView[] = [];
  let answered = 0;

  for (let i = 0; i < parts.length; i++) {
    const blankRuntime = session.blanks[i];
    let blank: BlankView | null = null;
    if (blankRuntime) {
      const value = session.answers[blankRuntime.index] || '';
      if (value.trim()) answered += 1;
      const judge = judged ? judged[blankRuntime.index] : undefined;
      const correct = judge ? judge.result === 'CORRECT' || judge.result === 'PUNCT' : false;
      const showHint = hintBlank === blankRuntime.index && !!hintChar;
      blank = {
        index: blankRuntime.index,
        value,
        width: blankWidth(blankRuntime.answer),
        hint: showHint ? hintChar : '',
        state: judge ? (correct ? 'correct' : 'wrong') : 'none',
        answer: blankRuntime.answer,
        correct,
      };
    }
    segments.push({ text: parts[i], blank });
  }

  const total = session.blanks.length;
  return {
    segments,
    answered,
    total,
    progressPercent: total > 0 ? Math.round((answered / total) * 100) : 0,
    modeLabel: MODE_LABEL[session.mode],
    showHintGhost: hintBlank !== null && !!hintChar,
  };
}

/** 反向默写的线索卡（打乱顺序 + 挖空分句） */
export function dictationClues(session: PracticeSession): Array<{ displayOrder: number; text: string }> {
  if (!session.dictation) return [];
  return session.dictation.shuffled.map((c) => ({ displayOrder: c.displayOrder, text: c.displayText }));
}

/** 段落范围可选项（练习设置面板用） */
export function sectionOptions(session: PracticeSession): Array<{ index: number; label: string; preview: string }> {
  // 由调用方（页面）用 SectionSplitter 生成；此处仅保留占位，避免页面直接依赖算法
  void session;
  return [];
}