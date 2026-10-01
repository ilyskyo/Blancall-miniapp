/**
 * 导入页纯逻辑：扩展名判定 / 字数统计 / 标题推断 / 缩进预览
 */

import { applyFirstLineIndent } from '../../core/algorithms/text';

export type ImportSource = 'paste' | 'file' | 'sample';

/** 本地可解析的纯文本扩展名（其余走云端解析） */
export const LOCAL_EXTS = ['txt', 'md'];

/** 支持的全部扩展名 */
export const ALL_EXTS = ['txt', 'md', 'pdf', 'doc', 'docx', 'epub', 'rtf', 'html'];

export function extOf(path: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(path || '');
  return m ? m[1].toLowerCase() : '';
}

export function fileNameOf(path: string): string {
  const parts = (path || '').split('/');
  return parts[parts.length - 1] || '';
}

export function isLocalText(ext: string): boolean {
  return LOCAL_EXTS.indexOf(ext) >= 0;
}

/** 字数统计：忽略空白字符 */
export function wordCountOf(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** 无标题时用首个非空行推断 */
export function titleFromText(text: string, fallback = '未命名'): string {
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.slice(0, 40);
  }
  return fallback;
}

export const PREVIEW_LIMIT = 300;

/** 预览文本：纯文本按需补首行缩进后截断 */
export function previewOf(text: string, autoIndent: boolean): string {
  const body = autoIndent ? applyFirstLineIndent(text) : text;
  const trimmed = body.length > PREVIEW_LIMIT ? `${body.slice(0, PREVIEW_LIMIT)}…` : body;
  return trimmed || '（暂无内容）';
}

export interface ReadResult {
  ok: boolean;
  text: string;
  /** 非 UTF-8（无法解码）时提示另存为 UTF-8 */
  encodingError: boolean;
}

/**
 * 读取本地纯文本（UTF-8）；含替换字符时判定为 GB18030 等非 UTF-8 编码，
 * 小程序端无 GBK 解码能力，提示用户「请另存为 UTF-8」。
 */
export function readLocalText(path: string): ReadResult {
  try {
    const raw = wx.getFileSystemManager().readFileSync(path, 'utf8');
    const text = (typeof raw === 'string' ? raw : '').replace(/^\uFEFF/, '');
    if (text.indexOf('\uFFFD') >= 0) return { ok: false, text: '', encodingError: true };
    return { ok: true, text, encodingError: false };
  } catch (e) {
    console.error('[import] 读取文件失败', e);
    return { ok: false, text: '', encodingError: false };
  }
}