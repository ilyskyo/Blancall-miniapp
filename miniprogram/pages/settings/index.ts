/**
 * 设置页（分组与原产品一致：外观 / 特性 / 复习 / 学习提醒 / 内容管理 / 拓展功能 / 账户 / 关于）
 */

import { ACCENT_PRESETS, onThemeChange, themeStyle } from '../../core/theme/theme';
import {
  AppSettings,
  getSettings,
  LightBackground,
  ReviewTemplateId,
  ThemeMode,
  updateSettings,
} from '../../core/storage/prefs';
import {
  currentUser,
  entitlementsSnapshot,
  loadEntitlements,
  logout,
  requireLogin,
} from '../../core/net/auth';
import { APP_VERSION } from '../../core/config';
import { clearLocalData, errText, exportToChat, fmtBytes, requestReminderSubscribe } from './indexLogic';
import { emit, EVT } from '../../core/store/bus';

interface Option<T> {
  value: T;
  label: string;
}

const THEME_OPTIONS: Array<Option<ThemeMode>> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const BG_OPTIONS: Array<Option<LightBackground>> = [
  { value: 'beige', label: '米白' },
  { value: 'white', label: '纯白' },
];

const TEMPLATE_OPTIONS: Array<Option<ReviewTemplateId>> = [
  { value: 'sprint', label: '冲刺（留存 85%）' },
  { value: 'standard', label: '标准（留存 90%）' },
  { value: 'deep', label: '深度（留存 95%）' },
];

/**
 * 提醒频率：取值必须与服务端调度实现一致（server/src/reminder）
 * DAILY = 每天；WEEKLY_FIVE = 周一至周五；WEEKLY_THREE = 周一/三/五
 */
const FREQ_OPTIONS: Option<string>[] = [
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKLY_FIVE', label: '周一至五' },
  { value: 'WEEKLY_THREE', label: '一三五' },
];

const GOAL_MINUTES = [5, 10, 15, 20, 30];

const LICENSES_TEXT = [
  '本小程序为个人学习工具。',
  '开源与第三方声明：',
  '· 代码基于 MIT 许可的开源实现迁移；',
  '· 记忆调度采用 FSRS 算法（源自 fsrs-rs，MIT / 参考实现）；',
  '· 内置素材库「高考必背 60 篇」为公版古诗文文本，仅用于个人背诵学习；',
  '· 内置字体来自各自开源许可（如 OFL），版权归原作者所有。',
  '若涉及版权问题，请联系我们处理。',
].join('\n');

/** 主题变化订阅解绑（模块级，页面单实例） */
let offTheme: (() => void) | null = null;

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    version: APP_VERSION,
    licensesText: LICENSES_TEXT,

    // 外观
    themeMode: 'system' as ThemeMode,
    themeOptions: THEME_OPTIONS,
    lightBackground: 'beige' as LightBackground,
    bgOptions: BG_OPTIONS,
    accentColor: 0,
    accentPresets: ACCENT_PRESETS,
    navLiquidGlass: true,
    subtitle: '',

    // 特性
    autoIndentEnabled: true,
    backWarningDisabled: false,
    showHint: true,
    useAiCloze: false,
    telemetryEnabled: true,

    // 复习
    reviewTemplate: 'standard' as ReviewTemplateId,
    templateOptions: TEMPLATE_OPTIONS,
    useSimilarityRating: true,

    // 学习提醒
    reminderEnabled: false,
    reminderTimeText: '20:00',
    reminderGoalMinutes: 10,
    goalMinuteLabels: GOAL_MINUTES.map((n) => `${n} 分钟`),
    reminderGoalIndex: 1,
    reminderGoalText: '10 分钟',
    reminderFrequency: 'DAILY',
    freqOptions: FREQ_OPTIONS,
    freqLabels: FREQ_OPTIONS.map((o) => o.label),
    freqIndex: 0,
    freqText: '每天',

    // 拓展功能
    builtInLibraryEnabled: false,

    // 账户
    loggedIn: false,
    nickname: '未登录（点击登录）',
    spaceText: '—',
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style) => this.setData({ themeStyle: style }));
    this.refresh();
  },

  onShow() {
    this.refresh();
    void loadEntitlements()
      .then(() => this.refreshAccount())
      .catch(() => this.refreshAccount());
  },

  onUnload() {
    this.__destroyed = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  /** 从本地设置刷新全部开关 */
  refresh() {
    if (this.__destroyed) return;
    const s = getSettings();
    const goalIndex = Math.max(0, GOAL_MINUTES.indexOf(s.reminderGoalMinutes));
    const freqIndex = Math.max(0, FREQ_OPTIONS.map((o) => o.value).indexOf(s.reminderFrequency));
    const hour = String(s.reminderHour).padStart(2, '0');
    const minute = String(s.reminderMinute).padStart(2, '0');
    this.setData({
      themeMode: s.themeMode,
      lightBackground: s.lightBackground,
      accentColor: s.accentColor,
      navLiquidGlass: s.navLiquidGlass,
      subtitle: s.subtitle,
      autoIndentEnabled: s.autoIndentEnabled,
      backWarningDisabled: s.backWarningDisabled,
      showHint: s.showHint,
      useAiCloze: s.useAiCloze,
      telemetryEnabled: s.telemetryEnabled !== false,
      reviewTemplate: (s.reviewTemplate as ReviewTemplateId) || 'standard',
      useSimilarityRating: s.useSimilarityRating,
      reminderEnabled: s.reminderEnabled,
      reminderTimeText: `${hour}:${minute}`,
      reminderGoalIndex: goalIndex,
      reminderGoalText: this.data.goalMinuteLabels[goalIndex],
      reminderGoalMinutes: s.reminderGoalMinutes,
      reminderFrequency: s.reminderFrequency,
      freqIndex,
      freqText: this.data.freqLabels[freqIndex],
      builtInLibraryEnabled: (s.builtInLibraryKeys || []).includes('gaokao'),
    });
    this.refreshAccount();
  },

  /** 账户信息 */
  refreshAccount() {
    if (this.__destroyed) return;
    const user = currentUser();
    const ent = entitlementsSnapshot();
    const space = ent ? ent.space : null;
    this.setData({
      loggedIn: !!user,
      nickname: user ? user.nickname || '已登录' : '未登录（点击登录）',
      spaceText: space ? `${fmtBytes(space.usedBytes)} / ${fmtBytes(space.totalBytes)}` : '—',
    });
  },

  /** 写设置并同步页面 + 主题刷新 */
  patch(patch: Partial<AppSettings>) {
    updateSettings(patch);
    this.refresh();
  },

  // ---------- 外观 ----------

  onSelectTheme(e: WechatMiniprogram.TouchEvent) {
    const value = String(e.currentTarget.dataset.value) as ThemeMode;
    this.patch({ themeMode: value });
  },

  onSelectBg(e: WechatMiniprogram.TouchEvent) {
    const value = String(e.currentTarget.dataset.value) as LightBackground;
    this.patch({ lightBackground: value });
  },

  onSelectAccent(e: WechatMiniprogram.TouchEvent) {
    this.patch({ accentColor: Number(e.currentTarget.dataset.index) });
  },

  onToggleNavGlass(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.patch({ navLiquidGlass: e.detail.checked });
  },

  onEditSubtitle() {
    wx.showModal({
      title: '首页副标题',
      editable: true,
      placeholderText: '输入首页副标题（留空则不显示）',
      content: this.data.subtitle,
      success: (res) => {
        if (res.confirm) this.patch({ subtitle: (res.content || '').trim() });
      },
    });
  },

  // ---------- 特性 ----------

  onToggleAutoIndent(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.patch({ autoIndentEnabled: e.detail.checked });
  },

  onToggleBackWarning(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.patch({ backWarningDisabled: e.detail.checked });
  },

  onToggleShowHint(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.patch({ showHint: e.detail.checked });
  },

  /** 设置页新增：标签管理入口 */
  onOpenTags() {
    wx.navigateTo({ url: '/packages/tools/pages/tags/index' });
  },

  onOpenHelp() {
    wx.navigateTo({ url: '/pages/help/index' });
  },

  onOpenAiChat() {
    wx.navigateTo({ url: '/packages/ai/pages/ai/index' });
  },

  onOpenAiHistory() {
    wx.navigateTo({ url: '/packages/ai/pages/ai-history/index' });
  },

  onToggleTelemetry(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.patch({ telemetryEnabled: e.detail.checked });
  },

  onToggleAiCloze() {
    this.patch({ useAiCloze: !this.data.useAiCloze });
  },

  // ---------- 复习 ----------

  onSelectTemplate(e: WechatMiniprogram.TouchEvent) {
    this.patch({ reviewTemplate: String(e.currentTarget.dataset.value) });
  },

  onToggleSimilarity(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    this.patch({ useSimilarityRating: e.detail.checked });
  },

  // ---------- 学习提醒 ----------

  async onToggleReminder(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    const next = e.detail.checked;
    if (!next) {
      this.patch({ reminderEnabled: false });
      return;
    }
    // 微信侧提醒依赖「一次性订阅消息」：开关打开时请求授权
    const granted = await requestReminderSubscribe();
    this.patch({ reminderEnabled: true });
    wx.showToast({
      title: granted ? '已开启，提醒由服务端定时发送' : '已开启，但未授权订阅，可能收不到提醒',
      icon: 'none',
      duration: 2600,
    });
  },

  onPickReminderTime(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const value = e.detail.value || '20:00';
    const [h, m] = value.split(':');
    this.patch({ reminderHour: Number(h) || 0, reminderMinute: Number(m) || 0 });
  },

  onPickGoalMinutes(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const idx = Number(e.detail.value) || 0;
    this.patch({ reminderGoalMinutes: GOAL_MINUTES[idx] || 10 });
  },

  onPickFrequency(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const idx = Number(e.detail.value) || 0;
    this.patch({ reminderFrequency: FREQ_OPTIONS[idx] ? FREQ_OPTIONS[idx].value : 'DAILY' });
  },

  // ---------- 内容管理 ----------

  async onExportCsv() {
    if (!requireLogin()) return;
    try {
      wx.showLoading({ title: '生成中', mask: true });
      await exportToChat('csv');
      wx.showToast({ title: '已生成，请选择转发对象', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: errText(err), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onExportBackup() {
    if (!requireLogin()) return;
    try {
      wx.showLoading({ title: '生成中', mask: true });
      await exportToChat('backup');
      wx.showToast({ title: '已生成，请选择转发对象', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: errText(err), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onClearLocal() {
    wx.showModal({
      title: '清空本地数据',
      content: '将删除本机的全部文章、练习记录、标签、断点与统计（云端数据不受影响）。此操作不可撤销，确定继续？',
      confirmText: '清空',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        clearLocalData();
        wx.showToast({ title: '本地数据已清空', icon: 'success' });
      },
    });
  },

  // ---------- 拓展功能 ----------

  onToggleLibrary(e: WechatMiniprogram.CustomEvent<{ checked: boolean }>) {
    const cur = getSettings().builtInLibraryKeys || [];
    const next = e.detail.checked ? Array.from(new Set([...cur, 'gaokao'])) : cur.filter((k) => k !== 'gaokao');
    this.patch({ builtInLibraryKeys: next });
    wx.showToast({ title: e.detail.checked ? '已启用素材库' : '已关闭素材库', icon: 'none' });
  },

  // ---------- 账户 ----------

  onTapAccount() {
    wx.navigateTo({ url: '/packages/account/pages/account/index' });
  },

  onTapAgreement(e: WechatMiniprogram.TouchEvent) {
    const type = String(e.currentTarget.dataset.type) || 'privacy';
    wx.navigateTo({ url: `/packages/account/pages/agreement/index?type=${type}` });
  },

  onOpenLicenses() {
    wx.showModal({ title: '开源许可与第三方声明', content: LICENSES_TEXT, showCancel: false, confirmText: '我知道了' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后云同步与 AI 功能不可用，本地数据仍保留。确定退出？',
      success: (res) => {
        if (!res.confirm) return;
        void logout()
          .then(() => {
            emit(EVT.entitlementsChanged);
            this.refresh();
            this.refreshAccount();
            wx.showToast({ title: '已退出登录', icon: 'none' });
          })
          .catch((err: unknown) => wx.showToast({ title: errText(err), icon: 'none' }));
      },
    });
  },

});