/**
 * 主题系统（替代 Android 端 Theme.kt + Color.kt 的浅色米白/纯白 + 深色纯黑 + 主题色）
 *
 * 实现：由 JS 计算 CSS 变量并注入页面根节点 style，避免依赖 theme.json 无法覆盖的
 * 米白/纯白切换与主题色。
 */

import { getSettings, onSettingsChange, AppSettings } from '../storage/prefs';

export interface ThemeVars {
  dark: boolean;
  bg: string;
  bgElev: string;
  text: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentSoft: string;
  glassBg: string;
  glassBorder: string;
  glassHighlight: string;
  /** 强调色上的前景色（按钮文字） */
  onAccent: string;
  danger: string;
  success: string;
  warning: string;
}

/** 主题色预设（对应 Android Macaron 调色板的前 8 个） */
export const ACCENT_PRESETS: Array<{ name: string; color: string; soft: string }> = [
  { name: '靛蓝', color: '#4C6FFF', soft: 'rgba(76,111,255,0.14)' },
  { name: '青竹', color: '#2FA36B', soft: 'rgba(47,163,107,0.14)' },
  { name: '珊瑚', color: '#F2705B', soft: 'rgba(242,112,91,0.14)' },
  { name: '暖橙', color: '#E8A33D', soft: 'rgba(232,163,61,0.14)' },
  { name: '堇紫', color: '#8A5CF6', soft: 'rgba(138,92,246,0.14)' },
  { name: '湖蓝', color: '#2AA6C7', soft: 'rgba(42,166,199,0.14)' },
  { name: '豆沙', color: '#C96A8B', soft: 'rgba(201,106,139,0.14)' },
  { name: '石墨', color: '#5A5A5F', soft: 'rgba(90,90,95,0.14)' },
];

let systemDark = false;
try {
  const info = wx.getSystemInfoSync();
  systemDark = info.theme === 'dark';
  wx.onThemeChange?.((res) => {
    systemDark = res.theme === 'dark';
    notify();
  });
} catch {
  systemDark = false;
}

function isDark(settings: AppSettings): boolean {
  if (settings.themeMode === 'dark') return true;
  if (settings.themeMode === 'light') return false;
  return systemDark;
}

export function currentTheme(settings: AppSettings = getSettings()): ThemeVars {
  const dark = isDark(settings);
  const accent = ACCENT_PRESETS[settings.accentColor % ACCENT_PRESETS.length] || ACCENT_PRESETS[0];
  if (dark) {
    return {
      dark,
      bg: '#000000',
      bgElev: '#0E0E10',
      text: '#F2F2F7',
      textSecondary: '#9A9AA0',
      border: 'rgba(255,255,255,0.10)',
      accent: accent.color,
      accentSoft: 'rgba(255,255,255,0.10)',
      glassBg: 'rgba(22,22,24,0.72)',
      glassBorder: 'rgba(255,255,255,0.12)',
      glassHighlight: 'rgba(255,255,255,0.06)',
      onAccent: '#FFFFFF',
      danger: '#FF6B6B',
      success: '#4CD07D',
      warning: '#F0B429',
    };
  }
  const beige = settings.lightBackground === 'beige';
  return {
    dark,
    bg: beige ? '#F7F5F1' : '#FFFFFF',
    bgElev: beige ? '#FFFDFA' : '#F7F7F8',
    text: '#1C1C1E',
    textSecondary: '#6E6E73',
    border: 'rgba(0,0,0,0.08)',
    accent: accent.color,
    accentSoft: accent.soft,
    glassBg: 'rgba(255,255,255,0.86)',
    glassBorder: 'rgba(255,255,255,0.65)',
    glassHighlight: 'rgba(255,255,255,0.9)',
    onAccent: '#FFFFFF',
    danger: '#E5484D',
    success: '#2FA36B',
    warning: '#D9930D',
  };
}

/** 生成页面根节点 style 字符串（CSS 变量） */
export function themeStyle(settings: AppSettings = getSettings()): string {
  const t = currentTheme(settings);
  const vars: Record<string, string> = {
    '--bg': t.bg,
    '--bg-elev': t.bgElev,
    '--text': t.text,
    '--text-2': t.textSecondary,
    '--border': t.border,
    '--accent': t.accent,
    '--accent-soft': t.accentSoft,
    '--glass-bg': t.glassBg,
    '--glass-border': t.glassBorder,
    '--glass-highlight': t.glassHighlight,
    '--on-accent': t.onAccent,
    '--danger': t.danger,
    '--success': t.success,
    '--warning': t.warning,
  };
  return Object.keys(vars)
    .map((k) => `${k}:${vars[k]}`)
    .join(';');
}

type ThemeListener = (style: string) => void;
const listeners = new Set<ThemeListener>();

function notify(): void {
  const style = themeStyle();
  listeners.forEach((fn) => fn(style));
}

onSettingsChange(() => notify());

/** 订阅主题变化（页面 onLoad 订阅、onUnload 取消） */
export function onThemeChange(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 导航栏文字色（自定义导航栏用） */
export function navTextColor(settings: AppSettings = getSettings()): string {
  return isDark(settings) ? '#FFFFFF' : '#000000';
}

/** 状态栏高度（自定义导航栏布局用） */
export function statusBarHeight(): number {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return (info as { statusBarHeight?: number }).statusBarHeight || 20;
  } catch {
    return 20;
  }
}