"use strict";
/**
 * 云端上传（文档 / 自定义字体 / 头像）——个人私有（WorkBuddy 对象存储 + uploads 表）
 *
 * - 文件本体：cloud.storage（userPath 私有前缀），下载走短期签名 URL
 * - 元数据：uploads 表（kind = document | font | avatar）
 * - 文档解析：仅支持纯文本（TXT/MD）；PDF/DOCX 解析即将上线，明确提示
 * - 门控：需登录；受云空间配额限制
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reimport = exports.hasArticle = exports.errorText = exports.removeFont = exports.removeDocument = exports.listDocuments = exports.currentFontFamily = exports.rememberFont = exports.syncMyFonts = exports.loadFontFace = exports.signAvatarUrl = exports.uploadAvatarAndSave = exports.chooseFontFile = exports.uploadFont = exports.importDocumentAsArticle = exports.uploadDocument = exports.chooseFile = void 0;
const request_1 = require("../net/request");
const config_1 = require("../config");
const prefs_1 = require("../storage/prefs");
const entities_1 = require("../storage/entities");
const bus_1 = require("../store/bus");
const sync_1 = require("../net/sync");
const auth_1 = require("../net/auth");
const cloud_1 = require("../net/cloud");
const cloudapi_1 = require("../net/cloudapi");
const fs_1 = require("../storage/fs");
/** 从聊天记录选择文件（小程序唯一可用的"任意文件"来源） */
function chooseFile(extensions = ['txt', 'md', 'pdf', 'doc', 'docx', 'epub', 'rtf', 'html']) {
    return new Promise((resolve, reject) => {
        wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: extensions,
            success: (res) => {
                const file = res.tempFiles && res.tempFiles[0];
                if (!file) {
                    reject(new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '未选择文件' }));
                    return;
                }
                resolve(file.path);
            },
            fail: () => reject(new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '已取消选择' })),
        });
    });
}
exports.chooseFile = chooseFile;
function extOf(path) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(path);
    return m ? m[1].toLowerCase() : '';
}
/** 安全取文件大小（临时文件可能无法 stat，取不到返回 0） */
function safeFileSize(path) {
    try {
        return (0, fs_1.fileSize)(path);
    }
    catch {
        return 0;
    }
}
function readBytes(filePath) {
    try {
        const fsm = wx.getFileSystemManager();
        return fsm.readFileSync(filePath);
    }
    catch (e) {
        throw new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '读取文件失败，请重试', detail: e });
    }
}
function uid() {
    const s = (0, prefs_1.getSession)();
    if (!s || !s.userId)
        throw new request_1.ApiException({ code: 'UNAUTHORIZED', message: '请先登录' });
    return s.userId;
}
function db() {
    return (0, cloud_1.cloud)().database;
}
function userObjectPath(rel) {
    return (0, cloud_1.cloud)().storage.userPath(uid(), rel);
}
function toApiError(error, fallback) {
    const msg = (0, cloud_1.cloudErrorText)(error);
    return new request_1.ApiException({ code: 'UPSTREAM_FAILED', message: msg === '操作失败，请稍后重试' ? fallback : msg, detail: error });
}
const TEXT_EXTS = ['txt', 'md'];
/** 空间配额校验 */
async function ensureSpace(size, what) {
    if (size <= 0)
        return;
    try {
        const usage = await (0, cloudapi_1.fetchSpaceUsage)();
        if (usage && usage.usedBytes + size > usage.totalBytes) {
            throw new request_1.ApiException({
                code: 'SPACE_QUOTA_EXCEEDED',
                message: `云空间不足（已用 ${(usage.usedBytes / 1048576).toFixed(1)}MB / 共 ${(usage.totalBytes / 1048576).toFixed(0)}MB）`,
            });
        }
    }
    catch (e) {
        if (e instanceof request_1.ApiException && e.code === 'SPACE_QUOTA_EXCEEDED')
            throw e;
        /* 用量读取失败不阻塞上传 */
    }
    void what;
}
/** 校验并上传文档；返回文档记录（文本缓存供本会话内直接导入） */
async function uploadDocument(filePath, displayName) {
    var _a;
    if (!(0, prefs_1.isLoggedIn)())
        throw new request_1.ApiException({ code: 'UNAUTHORIZED', message: '请先登录后再上传文档' });
    const ext = extOf(filePath);
    const size = safeFileSize(filePath);
    if (size > 0 && size > config_1.LIMITS.documentMaxBytes) {
        throw new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '文件超过 50MB 限制' });
    }
    const space = (0, auth_1.spaceInfo)();
    if (space && size > 0 && space.usedBytes + size > space.totalBytes) {
        throw new request_1.ApiException({
            code: 'SPACE_QUOTA_EXCEEDED',
            message: `云空间不足（已用 ${(space.usedBytes / 1048576).toFixed(1)}MB / 共 ${(space.totalBytes / 1048576).toFixed(0)}MB）`,
        });
    }
    const name = (displayName || filePath.split('/').pop() || `上传文件.${ext}`).slice(0, 120);
    const body = readBytes(filePath);
    const objectPath = userObjectPath(`documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'bin'}`);
    const { error } = await (0, cloud_1.cloud)().storage.upload(objectPath, body, { contentType: contentTypeOf(ext) });
    if (error)
        throw toApiError(error, '上传失败');
    const row = {
        kind: 'document',
        name,
        ext,
        size: size || body.byteLength,
        path: objectPath,
        status: 'uploaded',
    };
    const ins = await db().from('uploads').insert(row).select('id');
    if (ins.error)
        throw toApiError(ins.error, '上传记录失败');
    const id = ((_a = (ins.data || [])[0]) === null || _a === void 0 ? void 0 : _a.id) || '';
    // 本会话内缓存纯文本，导入时免二次下载
    if (TEXT_EXTS.includes(ext)) {
        try {
            const text = arrayBufferToText(body);
            if (text.trim())
                textCache.set(id, { title: name.replace(/\.[^.]+$/, ''), text });
        }
        catch {
            /* 编码失败则走下载路径 */
        }
    }
    return { id, name, ext, size: row.size, status: 'uploaded' };
}
exports.uploadDocument = uploadDocument;
const textCache = new Map();
function arrayBufferToText(buffer) {
    const bytes = new Uint8Array(buffer);
    // 优先 UTF-8；基础库无 TextDecoder 时用手工解码兜底
    const decoderHolder = wx;
    try {
        if (!decoderHolder.__wbUtf8Decoder) {
            const Ctor = globalThis.TextDecoder;
            if (Ctor)
                decoderHolder.__wbUtf8Decoder = new Ctor('utf-8');
        }
        if (decoderHolder.__wbUtf8Decoder)
            return decoderHolder.__wbUtf8Decoder.decode(bytes);
    }
    catch {
        /* 走手工解码 */
    }
    let out = '';
    let i = 0;
    while (i < bytes.length) {
        const b0 = bytes[i++];
        if (b0 < 0x80)
            out += String.fromCharCode(b0);
        else if (b0 < 0xe0)
            out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
        else if (b0 < 0xf0)
            out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
        else {
            const cp = ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
            const v = cp - 0x10000;
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
        }
    }
    return out;
}
function contentTypeOf(ext) {
    if (ext === 'png')
        return 'image/png';
    if (ext === 'webp')
        return 'image/webp';
    if (ext === 'jpg' || ext === 'jpeg')
        return 'image/jpeg';
    if (ext === 'ttf')
        return 'font/ttf';
    if (ext === 'otf')
        return 'font/otf';
    if (ext === 'md')
        return 'text/markdown';
    if (ext === 'pdf')
        return 'application/pdf';
    return 'application/octet-stream';
}
/** 取上传行的文本内容（缓存 → 签名 URL 下载） */
async function loadStoredText(row) {
    const cached = textCache.get(row.id);
    if (cached)
        return cached.text;
    if (!TEXT_EXTS.includes((row.ext || '').toLowerCase())) {
        throw new request_1.ApiException({ code: 'NOT_SUPPORTED', message: 'PDF / DOCX 解析即将上线，请先上传 TXT / MD 文本' });
    }
    const { data: signed, error: signErr } = await (0, cloud_1.cloud)().storage.createSignedUrl(row.path, 600);
    if (signErr || !signed)
        throw toApiError(signErr || '签名失败', '获取下载地址失败');
    const text = await new Promise((resolve, reject) => {
        wx.request({
            url: signed.signedUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 30000,
            success: (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300)
                    resolve(arrayBufferToText(res.data));
                else
                    reject(new request_1.ApiException({ code: 'UPSTREAM_FAILED', message: `下载失败（${res.statusCode}）` }));
            },
            fail: (err) => reject(new request_1.ApiException({ code: 'NETWORK_ERROR', message: (0, request_1.readableError)('NETWORK_ERROR'), detail: err })),
        });
    });
    return text;
}
async function findUploadRow(id, kind) {
    let q = db().from('uploads').select('id,kind,name,ext,size,path,status,created_at').eq('id', id).limit(1);
    if (kind)
        q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error)
        throw toApiError(error, '读取上传记录失败');
    const rows = (data || []);
    if (rows.length === 0)
        throw new request_1.ApiException({ code: 'NOT_FOUND', message: (0, request_1.readableError)('NOT_FOUND') });
    return rows[0];
}
/** 解析文档并导入为文章（TXT/MD；其余格式明确提示） */
async function importDocumentAsArticle(docId, fallbackTitle = '导入文档') {
    var _a;
    const row = await findUploadRow(docId, 'document');
    const text = (await loadStoredText(row)).replace(/\r\n/g, '\n').trim();
    if (!text)
        throw new request_1.ApiException({ code: 'UPSTREAM_FAILED', message: '解析结果为空，请检查文件内容' });
    const title = (((_a = textCache.get(docId)) === null || _a === void 0 ? void 0 : _a.title) || row.name.replace(/\.[^.]+$/, '') || fallbackTitle).trim().slice(0, 60);
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const article = (0, entities_1.createArticle)({ title, content: text, autoIndent: false });
    (0, bus_1.emit)(bus_1.EVT.articlesChanged);
    (0, sync_1.scheduleSync)();
    return { articleUuid: article.uuid, parsed: { title, paragraphs, plainText: text } };
}
exports.importDocumentAsArticle = importDocumentAsArticle;
/** 上传自定义字体（TTF/OTF，个人私有） */
async function uploadFont(filePath) {
    var _a, _b;
    if (!(0, prefs_1.isLoggedIn)())
        throw new request_1.ApiException({ code: 'UNAUTHORIZED', message: '请先登录后再上传字体' });
    const ext = extOf(filePath);
    if (ext !== 'ttf' && ext !== 'otf') {
        throw new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '仅支持 TTF / OTF 字体（不支持 TTC）' });
    }
    const size = safeFileSize(filePath);
    if (size > 0 && size > config_1.LIMITS.fontMaxBytes) {
        throw new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '字体文件超过 20MB 限制' });
    }
    await ensureSpace(size, '字体');
    const family = ((_a = filePath.split('/').pop()) === null || _a === void 0 ? void 0 : _a.replace(/\.(ttf|otf)$/i, '')) || '自定义字体';
    const body = readBytes(filePath);
    const objectPath = userObjectPath(`fonts/${Date.now()}.${ext}`);
    const { error } = await (0, cloud_1.cloud)().storage.upload(objectPath, body, { contentType: contentTypeOf(ext) });
    if (error)
        throw toApiError(error, '上传失败');
    const ins = await db()
        .from('uploads')
        .insert({ kind: 'font', name: family, ext, size: size || body.byteLength, path: objectPath, status: 'uploaded' })
        .select('id');
    if (ins.error)
        throw toApiError(ins.error, '上传记录失败');
    const id = ((_b = (ins.data || [])[0]) === null || _b === void 0 ? void 0 : _b.id) || '';
    return { id, family, url: objectPath, size: size || body.byteLength };
}
exports.uploadFont = uploadFont;
/** 选择字体文件（从聊天记录） */
function chooseFontFile() {
    return chooseFile(['ttf', 'otf']);
}
exports.chooseFontFile = chooseFontFile;
const AVATAR_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
/**
 * 头像上传：对象存储 → 短期签名 URL 写入资料 → 刷新本地会话头像。
 * user_profile.avatar 存对象路径（长期有效），session.avatar 存签名 URL（7 天，refreshProfile 时重签）。
 */
async function uploadAvatarAndSave(filePath) {
    if (!(0, prefs_1.isLoggedIn)())
        throw new request_1.ApiException({ code: 'UNAUTHORIZED', message: '请先登录后再修改头像' });
    const ext = extOf(filePath) || 'png';
    if (!AVATAR_EXTS.includes(ext)) {
        throw new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '头像仅支持 JPG / PNG / WEBP 格式' });
    }
    const size = safeFileSize(filePath);
    if (size > 0 && size > config_1.LIMITS.avatarMaxBytes) {
        throw new request_1.ApiException({ code: 'INVALID_ARGUMENT', message: '头像图片超过 2MB 限制' });
    }
    const body = readBytes(filePath);
    const objectPath = userObjectPath(`avatar/${Date.now()}.${ext}`);
    const { error } = await (0, cloud_1.cloud)().storage.upload(objectPath, body, { contentType: contentTypeOf(ext) });
    if (error)
        throw toApiError(error, '上传失败');
    const signed = await signAvatarUrl(objectPath);
    await (0, cloudapi_1.upsertMyProfile)({ avatar: objectPath });
    const s = (0, prefs_1.getSession)();
    if (s)
        (0, prefs_1.setSession)({ ...s, avatar: signed });
    return signed;
}
exports.uploadAvatarAndSave = uploadAvatarAndSave;
/** 为头像对象路径签发 7 天可读 URL（对象路径不存在时返回空串） */
async function signAvatarUrl(objectPath) {
    if (!objectPath || objectPath.startsWith('http'))
        return objectPath;
    try {
        const { data, error } = await (0, cloud_1.cloud)().storage.createSignedUrl(objectPath, 604800);
        if (error || !data)
            return '';
        return data.signedUrl;
    }
    catch {
        return '';
    }
}
exports.signAvatarUrl = signAvatarUrl;
const loadedFamilies = new Set();
/**
 * 加载网络字体（wx.loadFontFace）
 * 域名 YOUR_CLOUD_ENDPOINT_HOST 需配置到小程序后台 downloadFile/request 合法域名。
 */
function loadFontFace(family, url) {
    if (!url)
        return Promise.reject(new request_1.ApiException({ code: 'UPSTREAM_FAILED', message: '字体地址无效' }));
    if (loadedFamilies.has(family))
        return Promise.resolve();
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
            fail: (err) => reject(new request_1.ApiException({ code: 'UPSTREAM_FAILED', message: '字体加载失败', detail: err })),
        });
    });
}
exports.loadFontFace = loadFontFace;
/** 我的字体列表（uploads 表）并签发 URL 尝试加载（进入阅读页时调用） */
async function syncMyFonts() {
    if (!(0, prefs_1.isLoggedIn)())
        return [];
    const { data, error } = await db().from('uploads').select('id,kind,name,ext,size,path,status,created_at').eq('kind', 'font').order('created_at', { ascending: false });
    if (error)
        throw toApiError(error, '读取字体列表失败');
    const rows = (data || []);
    const out = [];
    for (const row of rows) {
        const font = { id: row.id, family: row.name, url: row.path, size: Number(row.size) || 0 };
        try {
            const { data: signed } = await (0, cloud_1.cloud)().storage.createSignedUrl(row.path, 604800);
            await loadFontFace(font.family, signed ? signed.signedUrl : '');
            out.push({ ...font, url: signed ? signed.signedUrl : row.path });
        }
        catch {
            out.push(font);
        }
    }
    return out;
}
exports.syncMyFonts = syncMyFonts;
/** 记录最近一次使用的字体（阅读设置用） */
function rememberFont(family) {
    (0, prefs_1.updateSettings)({ readingFontId: family });
}
exports.rememberFont = rememberFont;
function currentFontFamily() {
    return (0, prefs_1.getSettings)().readingFontId || '0';
}
exports.currentFontFamily = currentFontFamily;
/** 我的云端文档列表（uploads 表） */
async function listDocuments() {
    if (!(0, prefs_1.isLoggedIn)())
        return [];
    const { data, error } = await db().from('uploads').select('id,kind,name,ext,size,path,status,created_at').eq('kind', 'document').order('created_at', { ascending: false });
    if (error)
        throw toApiError(error, '读取文档列表失败');
    return (data || []).map((r) => ({
        id: r.id,
        name: r.name,
        ext: r.ext || '',
        size: Number(r.size) || 0,
        status: 'uploaded',
    }));
}
exports.listDocuments = listDocuments;
/** 删除云端文档（对象存储 + 记录行，同时释放空间） */
async function removeDocument(id) {
    const row = await findUploadRow(id, 'document');
    try {
        await (0, cloud_1.cloud)().storage.remove([row.path]);
    }
    catch {
        /* 对象已不存在时继续删记录 */
    }
    const { error } = await db().from('uploads').delete().eq('id', id);
    if (error)
        throw toApiError(error, '删除记录失败');
}
exports.removeDocument = removeDocument;
/** 删除自定义字体 */
async function removeFont(id) {
    const row = await findUploadRow(id, 'font');
    try {
        await (0, cloud_1.cloud)().storage.remove([row.path]);
    }
    catch {
        /* 忽略 */
    }
    const { error } = await db().from('uploads').delete().eq('id', id);
    if (error)
        throw toApiError(error, '删除记录失败');
}
exports.removeFont = removeFont;
function errorText(e) {
    if (e instanceof request_1.ApiException)
        return e.message || (0, request_1.readableError)(e.code);
    return e instanceof Error ? e.message : '操作失败';
}
exports.errorText = errorText;
/** 已存在同名文章提示（避免重复导入） */
function hasArticle(title) {
    return entities_1.articleStore.list().some((a) => a.title === title);
}
exports.hasArticle = hasArticle;
/** 把已上传文档再次导入（从"我的云端资料"列表） */
async function reimport(doc) {
    const res = await importDocumentAsArticle(doc.id, doc.name.replace(/\.[^.]+$/, ''));
    return res.articleUuid;
}
exports.reimport = reimport;
