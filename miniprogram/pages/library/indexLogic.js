"use strict";
/**
 * 素材库辅助逻辑（列表构建 / 免责声明 / 启停 / 缓存读写的错误口径）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadText = exports.loadIndex = exports.importToArticle = exports.LIBRARY_DISCLAIMER = exports.setLibraryEnabled = exports.markDisclaimerSeen = exports.disclaimerSeen = exports.buildCards = void 0;
const config_1 = require("../../core/config");
const gaokao_1 = require("../../core/library/gaokao");
Object.defineProperty(exports, "LIBRARY_DISCLAIMER", { enumerable: true, get: function () { return gaokao_1.LIBRARY_DISCLAIMER; } });
Object.defineProperty(exports, "importToArticle", { enumerable: true, get: function () { return gaokao_1.importToArticle; } });
Object.defineProperty(exports, "loadIndex", { enumerable: true, get: function () { return gaokao_1.loadIndex; } });
Object.defineProperty(exports, "loadText", { enumerable: true, get: function () { return gaokao_1.loadText; } });
const prefs_1 = require("../../core/storage/prefs");
/** 构建素材库卡片（当前仅 gaokao） */
function buildCards() {
    const keys = (0, prefs_1.getSettings)().builtInLibraryKeys || [];
    return config_1.LIBRARIES.map((l) => ({
        key: l.key,
        name: l.name,
        subtitle: '高考语文必背 60 篇',
        note: '仅文本',
        enabled: keys.includes(l.key),
    }));
}
exports.buildCards = buildCards;
/** 是否已确认免责声明 */
function disclaimerSeen(key = 'gaokao') {
    return ((0, prefs_1.getSettings)().libraryDisclaimerSeen || []).includes(key);
}
exports.disclaimerSeen = disclaimerSeen;
/** 记录免责声明已确认 */
function markDisclaimerSeen(key = 'gaokao') {
    const cur = (0, prefs_1.getSettings)().libraryDisclaimerSeen || [];
    if (!cur.includes(key))
        (0, prefs_1.updateSettings)({ libraryDisclaimerSeen: [...cur, key] });
}
exports.markDisclaimerSeen = markDisclaimerSeen;
/** 启用/停用某内置库 */
function setLibraryEnabled(key, enabled) {
    const cur = (0, prefs_1.getSettings)().builtInLibraryKeys || [];
    const next = enabled ? Array.from(new Set([...cur, key])) : cur.filter((k) => k !== key);
    (0, prefs_1.updateSettings)({ builtInLibraryKeys: next });
}
exports.setLibraryEnabled = setLibraryEnabled;
