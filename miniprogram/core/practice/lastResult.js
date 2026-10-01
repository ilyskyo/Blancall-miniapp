"use strict";
/**
 * 练习结果交接（练习页 → 结果页）
 * 不落盘（避免污染存储），仅在同一次导航生命周期内使用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorTypeText = exports.peekLastResult = exports.takeLastResult = exports.setLastResult = void 0;
let last = null;
function setLastResult(result) {
    last = result;
}
exports.setLastResult = setLastResult;
function takeLastResult() {
    const cur = last;
    last = null;
    return cur;
}
exports.takeLastResult = takeLastResult;
function peekLastResult() {
    return last;
}
exports.peekLastResult = peekLastResult;
/** 结果页用：可读的错误类型文案 */
function errorTypeText(errorType) {
    switch (errorType) {
        case 'TYPO':
            return '错别字';
        case 'MISSING':
            return '漏字';
        case 'EXTRA':
            return '多填';
        case 'WRONG_ORDER':
            return '顺序错';
        default:
            return '未正确';
    }
}
exports.errorTypeText = errorTypeText;
