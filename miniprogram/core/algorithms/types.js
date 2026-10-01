"use strict";
/**
 * Blancall 小程序 · 算法共享类型
 *
 * 与 Android 端（Kotlin）数据结构一一对应；改造点：自增 id → uuid（UUIDv7 字符串）。
 * 各算法模块的专属结果类型定义在各自文件内，避免循环依赖。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.str = exports.num = exports.SENTENCE_KEY_PREFIX = exports.emptyErrorProfile = void 0;
/** 构造空 ErrorProfile（memoryFactor 默认 1） */
function emptyErrorProfile(memoryFactor = 1) {
    return {
        sentenceErrorRates: {},
        charErrorRates: {},
        wordErrorRates: {},
        memoryFactor,
    };
}
exports.emptyErrorProfile = emptyErrorProfile;
/** 句子级 FSRS 键前缀（SentenceSelector.SENTENCE_KEY_PREFIX） */
exports.SENTENCE_KEY_PREFIX = 's:';
/** 通用：安全取数值（缺省时回退） */
function num(v, fallback = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
exports.num = num;
/** 通用：安全取字符串 */
function str(v, fallback = '') {
    return typeof v === 'string' ? v : fallback;
}
exports.str = str;
