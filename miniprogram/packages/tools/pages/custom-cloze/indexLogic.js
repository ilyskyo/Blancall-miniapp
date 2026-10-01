"use strict";
/**
 * 自定义挖空列表纯逻辑：配置行视图（模式文案 / 时间 / 空数）与「当前配置」本地键
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeConfigKey = exports.buildConfigRows = exports.MODE_LABELS = void 0;
const date_1 = require("../../../../core/utils/date");
exports.MODE_LABELS = {
    SENTENCE: '句子挖空',
    WORD: '字词挖空',
    REVERSE: '反向默写',
};
/** 构建列表行（按 createdAt 升序，与存储顺序一致） */
function buildConfigRows(configs, activeUuid) {
    return configs.map((c) => {
        const active = c.uuid === activeUuid;
        return {
            uuid: c.uuid,
            name: c.name,
            createdText: (0, date_1.formatFull)(c.createdAt),
            modeLabel: exports.MODE_LABELS[c.mode] || '句子挖空',
            blankCount: (c.blanks || []).length,
            activeCls: active ? 'chip' : 'chip chip--muted',
            activeLabel: active ? '当前' : '设为当前',
        };
    });
}
exports.buildConfigRows = buildConfigRows;
/** 「当前配置」本地键（练习时作为 configUuid 默认值） */
function activeConfigKey(articleUuid) {
    return `custom_cloze_active/${articleUuid}`;
}
exports.activeConfigKey = activeConfigKey;
