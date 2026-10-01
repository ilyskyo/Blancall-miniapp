/**
 * 云端上传（文档 / 自定义字体 / 头像）——个人私有（WorkBuddy 对象存储 + uploads 表）
 *
 * - 文件本体：cloud.storage（userPath 私有前缀），下载走短期签名 URL
 * - 元数据：uploads 表（kind = document | font | avatar）
 * - 文档解析：仅支持纯文本（TXT/MD）；PDF/DOCX 解析即将上线，明确提示
 * - 门控：需登录；受云空间配额限制
 */

import { ParsedDocument, UploadedDocument, UploadedFont } from '../net/api';
import { ApiException, readableError } from '../net/request';
import { LIMITS } from '../config';
import { isLoggedIn, getSettings, setSession, getSession, updateSettings } from '../storage/prefs';
import { createArticle, articleStore } from '../storage/entities';
import { emit, EVT } from '../store/bus';
import { scheduleSync } from '../net/sync';
import { spaceInfo } from '../net/auth';
import { cloud, cloudErrorText } from '../net/cloud';
import { fetchSpaceUsage, upsertMyProfile } from '../net/cloudapi';
import { fileSize } from '../storage/fs';

export interface UploadedFontLocal extends UploadedFont {
  /** 本地缓存路径（离线可用） */
  localPath?: string;
}

/** 从聊天记录选择文件（小程序唯一可用的"任意文件"来源） */
export function chooseFile(extensions: string[] = ['txt', 'md', 'pdf', 'doc', 'docx', 'epub', 'rtf', 'html']): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: extensions,
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          reject(new ApiException({ code: 'INVALID_ARGUMENT', message: '未选择文件' }));
          return;
        }
        resolve(file.path);
      },
      fail: () => reject(new ApiException({ code: 'INVALID_ARGUMENT', message: '已取消选择' })),
    });
  });
}

function extOf(path: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/** 安全取文件大小（临时文件可能无法 stat，取不到返回 0） */
function safeFileSize(path: string): number {
  try {
    return fileSize(path);
  } catch {
    return 0;
  }
}

function readBytes(filePath: string): ArrayBuffer {
  try {
    const fsm = wx.getFileSystemManager();
    return fsm.readFileSync(filePath) as unknown as ArrayBuffer;
  } catch (e) {
    throw new ApiException({ code: 'INVALID_ARGUMENT', message: '读取文件失败，请重试', detail: e });
  }
}

function uid(): string {
  const s = getSession();
  if (!s || !s.userId) throw new ApiException({ code: 'UNAUTHORIZED', message: '请先登录' });
  return s.userId;
}

function db() {
  return cloud().database;
}

function userObjectPath(rel: string): string {
  return cloud().storage.userPath(uid(), rel);
}

function toApiError(error: unknown, fallback: string): ApiException {
  const msg = cloudErrorText(error);
  return new ApiException({ code: 'UPSTREAM_FAILED', message: msg === '操作失败，请稍后重试' ? fallback : msg, detail: error });
}

const TEXT_EXTS = ['txt', 'md'];

/** 空间配额校验 */
async function ensureSpace(size: number, what: string): Promise<void> {
  if (size <= 0) return;
  try {
    const usage = await fetchSpaceUsage();
    if (usage && usage.usedBytes + size > usage.totalBytes) {
      throw new ApiException({
        code: 'SPACE_QUOTA_EXCEEDED',
        message: `云空间不足（已用 ${(usage.usedBytes / 1048576).toFixed(1)}MB / 共 ${(usage.totalBytes / 1048576).toFixed(0)}MB）`,
      });
    }
  } catch (e) {
    if (e instanceof ApiException && e.code === 'SPACE_QUOTA_EXCEEDED') throw e;
    /* 用量读取失败不阻塞上传 */
  }
  void what;
}

/** 上传行元数据 */
interface UploadRow {
  id: string;
  kind: string;
  name: string;
  ext: string | null;
  size: number;
  path: string;
  status: string;
  created_at: string;
}

/** 校验并上传文档；返回文档记录（文本缓存供本会话内直接导入） */
export async function uploadDocument(filePath: string, displayName?: string): Promise<UploadedDocument> {
  if (!isLoggedIn()) throw new ApiException({ code: 'UNAUTHORIZED', message: '请先登录后再上传文档' });
  const ext = extOf(filePath);
  const size = safeFileSize(filePath);
  if (size > 0 && size > LIMITS.documentMaxBytes) {
    throw new ApiException({ code: 'INVALID_ARGUMENT', message: '文件超过 50MB 限制' });
  }
  const space = spaceInfo();
  if (space && size > 0 && space.usedBytes + size > space.totalBytes) {
    throw new ApiException({
      code: 'SPACE_QUOTA_EXCEEDED',
      message: `云空间不足（已用 ${(space.usedBytes / 1048576).toFixed(1)}MB / 共 ${(space.totalBytes / 1048576).toFixed(0)}MB）`,
    });
  }
  const name = (displayName || filePath.split('/').pop() || `上传文件.${ext}`).slice(0, 120);
  const body = readBytes(filePath);
  const objectPath = userObjectPath(`documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'bin'}`);
  const { error } = await cloud().storage.upload(objectPath, body, { contentType: contentTypeOf(ext) });
  if (error) throw toApiError(error, '上传失败');
  const row = {
    kind: 'document',
    name,
    ext,
    size: size || (body as ArrayBuffer).byteLength,
    path: objectPath,
    status: 'uploaded',
  };
  const ins = await db().from('uploads').insert(row).select('id');
  if (ins.error) throw toApiError(ins.error, '上传记录失败');
  const id = ((ins.data || [])[0] as { id?: string } | undefined)?.id || '';
  // 本会话内缓存纯文本，导入时免二次下载
  if (TEXT_EXTS.includes(ext)) {
    try {
      const text = arrayBufferToText(body);
      if (text.trim()) textCache.set(id, { title: name.replace(/\.[^.]+$/, ''), text });
    } catch {
      /* 编码失败则走下载路径 */
    }
  }
  return { id, name, ext, size: row.size, status: 'uploaded' };
}

const textCache = new Map<string, { title: string; text: string }>();

function arrayBufferToText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // 优先 UTF-8；基础库无 TextDecoder 时用手工解码兜底
  const decoderHolder = wx as unknown as { __wbUtf8Decoder?: { decode(bytes: Uint8Array): string } };
  try {
    if (!decoderHolder.__wbUtf8Decoder) {
      const Ctor = (globalThis as unknown as { TextDecoder?: new (label: string) => { decode(bytes: Uint8Array): string } }).TextDecoder;
      if (Ctor) decoderHolder.__wbUtf8Decoder = new Ctor('utf-8');
    }
    if (decoderHolder.__wbUtf8Decoder) return decoderHolder.__wbUtf8Decoder.decode(bytes);
  } catch {
    /* 走手工解码 */
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b0 < 0xf0) out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return out;
}

function contentTypeOf(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'ttf') return 'font/ttf';
  if (ext === 'otf') return 'font/otf';
  if (ext === 'md') return 'text/markdown';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/** 取上传行的文本内容（缓存 → 签名 URL 下载） */
async function loadStoredText(row: UploadRow): Promise<string> {
  const cached = textCache.get(row.id);
  if (cached) return cached.text;
  if (!TEXT_EXTS.includes((row.ext || '').toLowerCase())) {
    throw new ApiException({ code: 'NOT_SUPPORTED', message: 'PDF / DOCX 解析即将上线，请先上传 TXT / MD 文本' });
  }
  const { data: signed, error: signErr } = await cloud().storage.createSignedUrl(row.path, 600);
  if (signErr || !signed) throw toApiError(signErr || '签名失败', '获取下载地址失败');
  const text = await new Promise<string>((resolve, reject) => {
    wx.request({
      url: signed.signedUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 30000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(arrayBufferToText(res.data as ArrayBuffer));
        else reject(new ApiException({ code: 'UPSTREAM_FAILED', message: `下载失败（${res.statusCode}）` }));
      },
      fail: (err) => reject(new ApiException({ code: 'NETWORK_ERROR', message: readableError('NETWORK_ERROR'), detail: err })),
    });
  });
  return text;
}

async function findUploadRow(id: string, kind?: string): Promise<UploadRow> {
  let q = db().from('uploads').select('id,kind,name,ext,size,path,status,created_at').eq('id', id).limit(1);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw toApiError(error, '读取上传记录失败');
  const rows = (data || []) as unknown as UploadRow[];
  if (rows.length === 0) throw new ApiException({ code: 'NOT_FOUND', message: readableError('NOT_FOUND') });
  return rows[0];
}

/** 解析文档并导入为文章（TXT/MD；其余格式明确提示） */
export async function importDocumentAsArticle(docId: string, fallbackTitle = '导入文档'): Promise<{ articleUuid: string; parsed: ParsedDocument }> {
  const row = await findUploadRow(docId, 'document');
  const text = (await loadStoredText(row)).replace(/\r\n/g, '\n').trim();
  if (!text) throw new ApiException({ code: 'UPSTREAM_FAILED', message: '解析结果为空，请检查文件内容' });
  const title = (textCache.get(docId)?.title || row.name.replace(/\.[^.]+$/, '') || fallbackTitle).trim().slice(0, 60);
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const article = createArticle({ title, content: text, autoIndent: false });
  emit(EVT.articlesChanged);
  scheduleSync();
  return { articleUuid: article.uuid, parsed: { title, paragraphs, plainText: text } };
}

/** 上传自定义字体（TTF/OTF，个人私有） */
export async function uploadFont(filePath: string): Promise<UploadedFont> {
  if (!isLoggedIn()) throw new ApiException({ code: 'UNAUTHORIZED', message: '请先登录后再上传字体' });
  const ext = extOf(filePath);
  if (ext !== 'ttf' && ext !== 'otf') {
    throw new ApiException({ code: 'INVALID_ARGUMENT', message: '仅支持 TTF / OTF 字体（不支持 TTC）' });
  }
  const size = safeFileSize(filePath);
  if (size > 0 && size > LIMITS.fontMaxBytes) {
    throw new ApiException({ code: 'INVALID_ARGUMENT', message: '字体文件超过 20MB 限制' });
  }
  await ensureSpace(size, '字体');
  const family = filePath.split('/').pop()?.replace(/\.(ttf|otf)$/i, '') || '自定义字体';
  const body = readBytes(filePath);
  const objectPath = userObjectPath(`fonts/${Date.now()}.${ext}`);
  const { error } = await cloud().storage.upload(objectPath, body, { contentType: contentTypeOf(ext) });
  if (error) throw toApiError(error, '上传失败');
  const ins = await db()
    .from('uploads')
    .insert({ kind: 'font', name: family, ext, size: size || (body as ArrayBuffer).byteLength, path: objectPath, status: 'uploaded' })
    .select('id');
  if (ins.error) throw toApiError(ins.error, '上传记录失败');
  const id = ((ins.data || [])[0] as { id?: string } | undefined)?.id || '';
  return { id, family, url: objectPath, size: size || (body as ArrayBuffer).byteLength };
}

/** 选择字体文件（从聊天记录） */
export function chooseFontFile(): Promise<string> {
  return chooseFile(['ttf', 'otf']);
}

const AVATAR_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * 头像上传：对象存储 → 短期签名 URL 写入资料 → 刷新本地会话头像。
 * user_profile.avatar 存对象路径（长期有效），session.avatar 存签名 URL（7 天，refreshProfile 时重签）。
 */
export async function uploadAvatarAndSave(filePath: string): Promise<string> {
  if (!isLoggedIn()) throw new ApiException({ code: 'UNAUTHORIZED', message: '请先登录后再修改头像' });
  const ext = extOf(filePath) || 'png';
  if (!AVATAR_EXTS.includes(ext)) {
    throw new ApiException({ code: 'INVALID_ARGUMENT', message: '头像仅支持 JPG / PNG / WEBP 格式' });
  }
  const size = safeFileSize(filePath);
  if (size > 0 && size > LIMITS.avatarMaxBytes) {
    throw new ApiException({ code: 'INVALID_ARGUMENT', message: '头像图片超过 2MB 限制' });
  }
  const body = readBytes(filePath);
  const objectPath = userObjectPath(`avatar/${Date.now()}.${ext}`);
  const { error } = await cloud().storage.upload(objectPath, body, { contentType: contentTypeOf(ext) });
  if (error) throw toApiError(error, '上传失败');
  const signed = await signAvatarUrl(objectPath);
  await upsertMyProfile({ avatar: objectPath });
  const s = getSession();
  if (s) setSession({ ...s, avatar: signed });
  return signed;
}

/** 为头像对象路径签发 7 天可读 URL（对象路径不存在时返回空串） */
export async function signAvatarUrl(objectPath: string): Promise<string> {
  if (!objectPath || objectPath.startsWith('http')) return objectPath;
  try {
    const { data, error } = await cloud().storage.createSignedUrl(objectPath, 604800);
    if (error || !data) return '';
    return data.signedUrl;
  } catch {
    return '';
  }
}

const loadedFamilies = new Set<string>();

/**
 * 加载网络字体（wx.loadFontFace）
 * 域名 YOUR_CLOUD_ENDPOINT_HOST 需配置到小程序后台 downloadFile/request 合法域名。
 */
export function loadFontFace(family: string, url: string): Promise<void> {
  if (!url) return Promise.reject(new ApiException({ code: 'UPSTREAM_FAILED', message: '字体地址无效' }));
  if (loadedFamilies.has(family)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    wx.loadFontFace({
      global: true,
      family,
      source: `url("${url}")`,
      scopes: ['webview'],
      success: () => {
        loadedFamilies.add(family);
        resolve();
      },
      fail: (err) => reject(new ApiException({ code: 'UPSTREAM_FAILED', message: '字体加载失败', detail: err })),
    } as WechatMiniprogram.LoadFontFaceOption);
  });
}

/** 我的字体列表（uploads 表）并签发 URL 尝试加载（进入阅读页时调用） */
export async function syncMyFonts(): Promise<UploadedFontLocal[]> {
  if (!isLoggedIn()) return [];
  const { data, error } = await db().from('uploads').select('id,kind,name,ext,size,path,status,created_at').eq('kind', 'font').order('created_at', { ascending: false });
  if (error) throw toApiError(error, '读取字体列表失败');
  const rows = (data || []) as unknown as UploadRow[];
  const out: UploadedFontLocal[] = [];
  for (const row of rows) {
    const font: UploadedFont = { id: row.id, family: row.name, url: row.path, size: Number(row.size) || 0 };
    try {
      const { data: signed } = await cloud().storage.createSignedUrl(row.path, 604800);
      await loadFontFace(font.family, signed ? signed.signedUrl : '');
      out.push({ ...font, url: signed ? signed.signedUrl : row.path });
    } catch {
      out.push(font);
    }
  }
  return out;
}

/** 记录最近一次使用的字体（阅读设置用） */
export function rememberFont(family: string): void {
  updateSettings({ readingFontId: family } as never);
}

export function currentFontFamily(): string {
  return getSettings().readingFontId || '0';
}

/** 我的云端文档列表（uploads 表） */
export async function listDocuments(): Promise<UploadedDocument[]> {
  if (!isLoggedIn()) return [];
  const { data, error } = await db().from('uploads').select('id,kind,name,ext,size,path,status,created_at').eq('kind', 'document').order('created_at', { ascending: false });
  if (error) throw toApiError(error, '读取文档列表失败');
  return ((data || []) as unknown as UploadRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    ext: r.ext || '',
    size: Number(r.size) || 0,
    status: 'uploaded' as const,
  }));
}

/** 删除云端文档（对象存储 + 记录行，同时释放空间） */
export async function removeDocument(id: string): Promise<void> {
  const row = await findUploadRow(id, 'document');
  try {
    await cloud().storage.remove([row.path]);
  } catch {
    /* 对象已不存在时继续删记录 */
  }
  const { error } = await db().from('uploads').delete().eq('id', id);
  if (error) throw toApiError(error, '删除记录失败');
}

/** 删除自定义字体 */
export async function removeFont(id: string): Promise<void> {
  const row = await findUploadRow(id, 'font');
  try {
    await cloud().storage.remove([row.path]);
  } catch {
    /* 忽略 */
  }
  const { error } = await db().from('uploads').delete().eq('id', id);
  if (error) throw toApiError(error, '删除记录失败');
}

export function errorText(e: unknown): string {
  if (e instanceof ApiException) return e.message || readableError(e.code);
  return e instanceof Error ? e.message : '操作失败';
}

/** 已存在同名文章提示（避免重复导入） */
export function hasArticle(title: string): boolean {
  return articleStore.list().some((a) => a.title === title);
}

/** 把已上传文档再次导入（从"我的云端资料"列表） */
export async function reimport(doc: UploadedDocument): Promise<string> {
  const res = await importDocumentAsArticle(doc.id, doc.name.replace(/\.[^.]+$/, ''));
  return res.articleUuid;
}
