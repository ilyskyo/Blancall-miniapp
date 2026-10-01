"use strict";
/**
 * AI 挖空输入约束（纯函数，无 wx 依赖，便于 Node 单测）
 *
 * 关键约束：单次请求只把全文前 `AI_CLOZE_MAX_CHARS` 个字符发给平台（与后端
 * `MAX_INPUT_CHARS` 一致），超出部分由本地算法补齐挖空。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_CLOZE_MAX_CHARS = void 0;
const config_1 = require("../config");
/** 单次 AI 挖空请求实际发送给平台的最大字符数 */
exports.AI_CLOZE_MAX_CHARS = config_1.LIMITS.aiClozeMaxChars;
