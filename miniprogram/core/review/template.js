"use strict";
/**
 * 复习模板 → FSRS 配置桥接
 *
 * 原产品（Android）行为：设置中的「复习模板」（冲刺/标准/深度）会影响
 * 1) FSRS 目标留存率（sprint 0.85 / standard 0.90 / deep 0.95）
 * 2) 无 FSRS 状态时的艾宾浩斯间隔兜底模板
 *
 * 小程序侧原先只保存了偏好、未接入算法，导致模板设置不生效 —— 本模块负责接线：
 * - 应用启动与设置变更时调用 `applyReviewTemplate()` 重新配置 FSRS 留存率
 * - 供统计/复习预测读取当前模板（`currentReviewTemplate()`）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_LABELS = exports.initReviewTemplate = exports.applyReviewTemplate = exports.currentReviewTemplate = exports.templateById = void 0;
const fsrs_1 = require("../algorithms/fsrs");
const ebbinghaus_1 = require("../algorithms/ebbinghaus");
const prefs_1 = require("../storage/prefs");
/** 模板 id → 艾宾浩斯模板对象（未知 id 回退标准模板） */
function templateById(id) {
    return ebbinghaus_1.ReviewTemplate.PRESETS.find((t) => t.id === id) || ebbinghaus_1.ReviewTemplate.STANDARD;
}
exports.templateById = templateById;
/** 当前用户选择的复习模板 */
function currentReviewTemplate() {
    return templateById((0, prefs_1.getSettings)().reviewTemplate || 'standard');
}
exports.currentReviewTemplate = currentReviewTemplate;
/** 把用户模板应用到 FSRS（目标留存率） */
function applyReviewTemplate() {
    const id = (0, prefs_1.getSettings)().reviewTemplate || 'standard';
    const retention = fsrs_1.FsrsEngine.retentionForTemplate(id);
    fsrs_1.FsrsEngine.configure(fsrs_1.FsrsEngine.DEFAULT_PARAMS, retention);
}
exports.applyReviewTemplate = applyReviewTemplate;
/** 在 app.onLaunch 调用一次，之后自动跟随设置变更 */
function initReviewTemplate() {
    applyReviewTemplate();
    (0, prefs_1.onSettingsChange)((next) => {
        const retention = fsrs_1.FsrsEngine.retentionForTemplate(next.reviewTemplate || 'standard');
        fsrs_1.FsrsEngine.configure(fsrs_1.FsrsEngine.DEFAULT_PARAMS, retention);
    });
}
exports.initReviewTemplate = initReviewTemplate;
/** 模板文案（设置页/帮助页共用） */
exports.TEMPLATE_LABELS = {
    sprint: '冲刺备考',
    standard: '标准记忆',
    deep: '深度长期',
};
