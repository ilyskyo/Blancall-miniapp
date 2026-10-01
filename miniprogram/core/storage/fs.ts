/**
 * 文件系统封装（小程序版 → 基于 wx Storage 实现）
 *
 * 【2026-09-30 小程序原生改造】用户拍板：小程序版不照搬 Android 的文件系统模式，
 * 直接用 wx.setStorageSync/getStorageSync（基础库 1.0 起可用，100% 兼容），
 * 彻底绕开 wx.getFileSystemManager（部分 devtools 环境缺失，曾导致
 * reLaunch:fail wx.getFileSystemManager is not a function）。
 *
 * - 上层接口签名保持不变（readText/writeTextAtomic/appendLine/readJson/writeJson/...）
 * - DB_DIR 仍是常量字符串，仅作为 storage key 前缀（'db'）
 * - 同步 Storage 写入本身原子，无半写损坏问题
 * - 注意：单 key 上限 1MB；appendLine 为读+拼+写，数据量大时需另行优化
 */

export const DB_DIR = 'db';

/** key 前缀（与 DB_DIR 同义，语义更明确） */
const PREFIX = 'db';

function normalize(file: string): string {
  // 去掉可能残留的历史前缀（老版本 USER_DATA_PATH 路径），统一为 db/... 形式
  const idx = file.indexOf(PREFIX + '/');
  return idx > 0 ? file.slice(idx) : file;
}

/** 确保目录存在（递归）——Storage 无目录概念，no-op */
export function ensureDir(_dir: string): void {
  /* Storage 模式无目录，保留接口兼容 */
}

/** 读文本；不存在返回 null */
export function readText(file: string): string | null {
  try {
    const v = wx.getStorageSync(normalize(file));
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'string' ? v : String(v);
  } catch {
    return null;
  }
}

/** 写文本（Storage 同步写即原子） */
export function writeTextAtomic(file: string, content: string): void {
  try {
    wx.setStorageSync(normalize(file), content);
  } catch (e) {
    // 单 key 1MB 超限等：明确抛给上层日志，不在静默中丢数据
    console.error('[fs] writeTextAtomic 失败', normalize(file), e);
  }
}

/** 追加一行（JSONL 用）：读 + 拼 + 写 */
export function appendLine(file: string, line: string): void {
  const cur = readText(file);
  writeTextAtomic(file, (cur ? cur : '') + line + '\n');
}

/** 删除文件（忽略不存在） */
export function removeFile(file: string): void {
  try {
    wx.removeStorageSync(normalize(file));
  } catch {
    /* 忽略 */
  }
}

/** 列出前缀下的所有 key（相对 DB_DIR 的路径） */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    const info = wx.getStorageInfoSync();
    const d = normalize(dir);
    const prefix = d.endsWith('/') ? d : d + '/';
    for (const k of info.keys) {
      if (k === d || k.startsWith(prefix)) {
        // 排除目录下的多级内容按需展开；这里返回剩余相对路径
        const rel = k.startsWith(prefix) ? k.slice(prefix.length) : '';
        if (rel) out.push(rel);
      }
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

/** 文件大小（字节）；不存在返回 0 */
export function fileSize(file: string): number {
  const v = readText(file);
  return v === null ? 0 : v.length;
}

/** 目录总大小（字节） */
export function dirSize(dir: string): number {
  let total = 0;
  for (const rel of listFiles(dir)) total += fileSize(`${dir}/${rel}`);
  return total;
}

/** 读取 JSON 文件并解析（跳过损坏文件） */
export function readJson<T>(file: string, fallback: T): T {
  const raw = readText(file);
  if (raw === null || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 保留损坏现场供排查（对应 Android 的 .corrupt-<ts>）
    try {
      wx.setStorageSync(`${normalize(file)}.corrupt-${Date.now()}`, raw);
    } catch {
      /* 忽略 */
    }
    return fallback;
  }
}

/** 写 JSON */
export function writeJson(file: string, value: unknown): void {
  writeTextAtomic(file, JSON.stringify(value));
}
