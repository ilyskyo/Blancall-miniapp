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

import { FsrsEngine } from '../algorithms/fsrs';
import { ReviewTemplate } from '../algorithms/ebbinghaus';
import { getSettings, onSettingsChange } from '../storage/prefs';

/** 模板 id → 艾宾浩斯模板对象（未知 id 回退标准模板） */
export function templateById(id: string): ReviewTemplate {
  return ReviewTemplate.PRESETS.find((t) => t.id === id) || ReviewTemplate.STANDARD;
}

/** 当前用户选择的复习模板 */
export function currentReviewTemplate(): ReviewTemplate {
  return templateById(getSettings().reviewTemplate || 'standard');
}

/** 把用户模板应用到 FSRS（目标留存率） */
export function applyReviewTemplate(): void {
  const id = getSettings().reviewTemplate || 'standard';
  const retention = FsrsEngine.retentionForTemplate(id);
  FsrsEngine.configure(FsrsEngine.DEFAULT_PARAMS, retention);
}

/** 在 app.onLaunch 调用一次，之后自动跟随设置变更 */
export function initReviewTemplate(): void {
  applyReviewTemplate();
  onSettingsChange((next) => {
    const retention = FsrsEngine.retentionForTemplate(next.reviewTemplate || 'standard');
    FsrsEngine.configure(FsrsEngine.DEFAULT_PARAMS, retention);
  });
}

/** 模板文案（设置页/帮助页共用） */
export const TEMPLATE_LABELS: Record<string, string> = {
  sprint: '冲刺备考',
  standard: '标准记忆',
  deep: '深度长期',
};