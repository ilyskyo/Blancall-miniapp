"use strict";
/**
 * 遮罩配置列表纯逻辑：配置行视图
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMaskRows = void 0;
const date_1 = require("../../../../core/utils/date");
function buildMaskRows(configs) {
    return configs.map((c) => ({
        uuid: c.uuid,
        name: c.name,
        createdText: (0, date_1.formatFull)(c.createdAt),
        spanCount: (c.spans || []).length,
        chipCls: c.selected ? 'chip' : 'chip chip--muted',
        chipLabel: c.selected ? '阅读生效中' : '设为生效',
    }));
}
exports.buildMaskRows = buildMaskRows;
