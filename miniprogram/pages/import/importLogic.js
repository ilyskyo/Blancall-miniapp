"use strict";
/**
 * 导入页纯逻辑：扩展名判定 / 字数统计 / 标题推断 / 缩进预览
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLocalText = exports.previewOf = exports.PREVIEW_LIMIT = exports.titleFromText = exports.wordCountOf = exports.isLocalText = exports.fileNameOf = exports.extOf = exports.ALL_EXTS = exports.LOCAL_EXTS = void 0;
const text_1 = require("../../core/algorithms/text");
/** 本地可解析的纯文本扩展名（其余走云端解析） */
exports.LOCAL_EXTS = ['txt', 'md'];
/** 支持的全部扩展名 */
exports.ALL_EXTS = ['txt', 'md', 'pdf', 'doc', 'docx', 'epub', 'rtf', 'html'];
function extOf(path) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(path || '');
    return m ? m[1].toLowerCase() : '';
}
exports.extOf = extOf;
function fileNameOf(path) {
    const parts = (path || '').split('/');
    return parts[parts.length - 1] || '';
}
exports.fileNameOf = fileNameOf;
function isLocalText(ext) {
    return exports.LOCAL_EXTS.indexOf(ext) >= 0;
}
exports.isLocalText = isLocalText;
/** 字数统计：忽略空白字符 */
function wordCountOf(text) {
    return text.replace(/\s+/g, '').length;
}
exports.wordCountOf = wordCountOf;
/** 无标题时用首个非空行推断 */
function titleFromText(text, fallback = '未命名') {
    const lines = text.split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (t)
            return t.slice(0, 40);
    }
    return fallback;
}
exports.titleFromText = titleFromText;
exports.PREVIEW_LIMIT = 300;
/** 预览文本：纯文本按需补首行缩进后截断 */
function previewOf(text, autoIndent) {
    const body = autoIndent ? (0, text_1.applyFirstLineIndent)(text) : text;
    const trimmed = body.length > exports.PREVIEW_LIMIT ? `${body.slice(0, exports.PREVIEW_LIMIT)}…` : body;
    return trimmed || '（暂无内容）';
}
exports.previewOf = previewOf;
/**
 * 读取本地纯文本（UTF-8）；含替换字符时判定为 GB18030 等非 UTF-8 编码，
 * 小程序端无 GBK 解码能力，提示用户「请另存为 UTF-8」。
 */
function readLocalText(path) {
    try {
        const raw = wx.getFileSystemManager().readFileSync(path, 'utf8');
        const text = (typeof raw === 'string' ? raw : '').replace(/^\uFEFF/, '');
        if (text.indexOf('\uFFFD') >= 0)
            return { ok: false, text: '', encodingError: true };
        return { ok: true, text, encodingError: false };
    }
    catch (e) {
        console.error('[import] 读取文件失败', e);
        return { ok: false, text: '', encodingError: false };
    }
}
exports.readLocalText = readLocalText;
