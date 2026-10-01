import { AppError } from '../common/errors';

export type ClozeMode = 'SENTENCE' | 'WORD' | 'REVERSE';

export interface ClozeSpan {
  sentence: number;
  start: number;
  end: number;
}

export type ClozeCoords = number[] | ClozeSpan[];

/** 上游请求体文本上限（对齐 Android 端「请求体截断 12000 字」） */
export const MAX_INPUT_CHARS = 12000;
/** 对话消息历史预算 */
export const HISTORY_BUDGET_CHARS = 14000;
/** 注入 system 的文章总量预算 */
export const ARTICLE_BUDGET_CHARS = 12000;
/** 单篇文章 system 截断 */
export const SINGLE_ARTICLE_CHARS = 8000;

const SYSTEM_BASE = [
  '你是「Blancall」背诵学习助手，服务于高考必背古诗文的挖空练习与训练分析。',
  '严格遵守：',
  '1) 你没有联网搜索能力，不得声称检索了网络资料；',
  '2) 只依据用户提供的文本作答，不得臆造原文；',
  '3) 输出简洁、准确，使用简体中文。',
].join('\n');

/** 挖空坐标提示词：强制「只返回坐标，不返回原文」 */
export function buildClozeMessages(input: {
  text: string;
  mode: ClozeMode;
  strategy?: string;
  level?: string | number;
  extra?: string;
}): Array<{ role: string; content: string }> {
  const modeDesc =
    input.mode === 'WORD'
      ? '字词模式：挖去句中部分字词'
      : input.mode === 'REVERSE'
        ? '反向默写模式：整段默写，需要给出应当默写的句子序号'
        : '句子模式：挖去整句';

  const outputSpec =
    input.mode === 'WORD'
      ? '输出 JSON 数组，元素形如 {"sentence": 句子序号, "start": 起始字符下标, "end": 结束字符下标}；下标为 0 起、含 start、不含 end。'
      : '输出 JSON 数组，元素为需要挖空的句子序号（从 0 开始，整数）。';

  const user = [
    `模式：${modeDesc}`,
    input.strategy ? `策略：${input.strategy}` : '',
    input.level !== undefined && input.level !== null ? `难度等级：${input.level}` : '',
    input.extra ? `补充要求：${input.extra}` : '',
    '',
    '要求：只输出坐标，绝对不要输出原文内容，不要输出解释，不要使用 Markdown 代码块。',
    outputSpec,
    '',
    '待处理文本：',
    input.text,
  ]
    .filter((l) => l !== '')
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_BASE },
    { role: 'user', content: user },
  ];
}

/** 训练分析提示词：输出 150–300 字 Markdown */
export function buildAnalysisMessages(input: {
  title?: string;
  mode?: string;
  accuracy?: number;
  mistakes?: unknown;
  weakHints?: unknown;
  strongHints?: unknown;
}): Array<{ role: string; content: string }> {
  const user = [
    '请基于以下一次背诵练习的结果，生成一段 150–300 字的学习分析（Markdown 格式，可用小标题与列表）。',
    '内容要求：指出主要错误类型与原因、给出可执行的改进建议、点出需要重点复习的字词或句子。',
    '',
    '练习数据（JSON）：',
    JSON.stringify(
      {
        title: input.title ?? '',
        mode: input.mode ?? '',
        accuracy: input.accuracy ?? null,
        mistakes: input.mistakes ?? [],
        weakHints: input.weakHints ?? null,
        strongHints: input.strongHints ?? null,
      },
      null,
      0,
    ),
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_BASE },
    { role: 'user', content: user },
  ];
}

/** 对话 system：注入文章上下文 + 学习数据摘要 */
export function buildChatSystem(articles: Array<{ title: string; content: string }>): string {
  const parts: string[] = [SYSTEM_BASE, '', '以下是用户当前正在学习的文章（仅供本次对话参考）：'];
  let budget = ARTICLE_BUDGET_CHARS;
  for (const a of articles) {
    if (budget <= 0) break;
    const slice = a.content.slice(0, Math.min(SINGLE_ARTICLE_CHARS, budget));
    budget -= slice.length;
    parts.push(`\n【${a.title}】\n${slice}`);
  }
  return parts.join('\n');
}

/** 去掉 Markdown 代码块包裹 */
function stripCodeFence(raw: string): string {
  let s = raw.trim();
  const fence = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/;
  const m = fence.exec(s);
  if (m) s = m[1].trim();
  s = s.replace(/```[a-zA-Z]*/g, '').replace(/```/g, '').trim();
  return s;
}

function tryParseArray(s: string): unknown[] | null {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 容错解析挖空坐标：支持 JSON 数组、代码块包裹、裸数字序列
 */
export function parseCoords(raw: string): ClozeCoords {
  const cleaned = stripCodeFence(raw ?? '');
  const arr = tryParseArray(cleaned);

  if (arr === null) {
    // 兜底：抽取裸数字
    const nums = (cleaned.match(/\d+/g) ?? [])
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isFinite(n));
    if (nums.length > 0) return Array.from(new Set(nums)).sort((a, b) => a - b);
    throw AppError.upstreamFailed('AI 返回内容无法解析为挖空坐标');
  }

  if (arr.every((v) => typeof v === 'number')) {
    return Array.from(
      new Set((arr as number[]).map((n) => Math.trunc(n)).filter((n) => n >= 0)),
    ).sort((a, b) => a - b);
  }

  const spans: ClozeSpan[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const sentence = Number(o.sentence ?? o.s ?? o.i);
    const start = Number(o.start ?? o.a);
    const end = Number(o.end ?? o.b ?? o.e);
    if (Number.isInteger(sentence) && Number.isInteger(start) && Number.isInteger(end)) {
      spans.push({ sentence, start, end });
    }
  }
  if (spans.length > 0) return spans;
  throw AppError.upstreamFailed('AI 返回坐标结构不符合预期');
}