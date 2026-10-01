"use strict";
/**
 * 「我的文章」列表纯逻辑：筛选（标签/隐藏）→ 排序 → 生成渲染行
 * WXML 不支持函数调用，摘要/时间/正确率等派生字段都在这里算好。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRows = exports.excerptOf = void 0;
const date_1 = require("../../core/utils/date");
/** 正文摘要：折叠空白取前 90 字 */
function excerptOf(content) {
    const flat = content.replace(/\s+/g, ' ').trim();
    return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}
exports.excerptOf = excerptOf;
function buildRows(inputs) {
    const hiddenSet = new Set(inputs.hidden);
    const selectedSet = new Set(inputs.selected);
    const filtered = inputs.articles.filter((a) => {
        if (!inputs.showHidden && hiddenSet.has(a.uuid))
            return false;
        if (inputs.tagFilter.length > 0) {
            const owned = inputs.tagsOf(a.uuid).map((t) => t.uuid);
            if (!inputs.tagFilter.some((t) => owned.indexOf(t) >= 0))
                return false;
        }
        return true;
    });
    const sorted = filtered.slice().sort((a, b) => {
        if (inputs.sortMode === 'created')
            return b.createdAt - a.createdAt;
        if (inputs.sortMode === 'accuracy')
            return inputs.accuracyOf(b.uuid) - inputs.accuracyOf(a.uuid);
        return b.updatedAt - a.updatedAt;
    });
    return sorted.map((a) => ({
        uuid: a.uuid,
        title: a.title,
        excerpt: excerptOf(a.content),
        tagNames: inputs.tagsOf(a.uuid).slice(0, 3).map((t) => t.name),
        timeText: inputs.sortMode === 'created' ? `创建 ${(0, date_1.formatShort)(a.createdAt)}` : `更新 ${(0, date_1.formatShort)(a.updatedAt)}`,
        accuracyText: `${Math.round(inputs.accuracyOf(a.uuid) * 100)}%`,
        hidden: hiddenSet.has(a.uuid),
        selected: selectedSet.has(a.uuid),
    }));
}
exports.buildRows = buildRows;
