/**
 * 首启引导：5 步卡片式说明；完成后写入 onboardingSeen 并回到首页
 */

import { onThemeChange, themeStyle } from '../../core/theme/theme';
import { updateSettings } from '../../core/storage/prefs';

interface Step {
  icon: string;
  title: string;
  desc: string;
  points: string[];
}

const STEPS: Step[] = [
  {
    icon: '👋',
    title: '欢迎使用 Blancall',
    desc: '一款专注「背诵 + 挖空练习」的学习工具，数据默认保存在本机，登录后可云同步。',
    points: ['基础功能永久免费，无需登录即可使用', '隐私优先：不上传你的文章内容', '深色/浅色外观跟随系统，可随时切换'],
  },
  {
    icon: '📥',
    title: '导入第一篇文章',
    desc: '支持粘贴文本、从聊天记录选择文件；素材库内置「高考必背 60 篇」可直接导入。',
    points: ['TXT / MD 在本机解析，无需联网', 'PDF / DOCX / EPUB 等需登录后由云端解析', '导入后可设置标题、作者与自动首行缩进'],
  },
  {
    icon: '✏️',
    title: '开始挖空练习',
    desc: '三种模式：句子挖空、字词挖空、反向默写；可按段落范围与策略出题。',
    points: ['逐空作答，自动判定对错并给出正确率', '10 秒无输入淡显提示字，再 5 秒自动填入', '中途离开会保存断点，随时继续练习'],
  },
  {
    icon: '📖',
    title: '阅读与背诵遮挡',
    desc: '分节阅读更轻松；背诵遮挡可在正文上盖住关键字词，点击揭示、再点遮回。',
    points: ['字号、行距、背景与字体可分别调整', '本地三粒度遮挡：短词 / 整句 / 混合', '自定义遮挡可自选段落区间与颜色'],
  },
  {
    icon: '🧠',
    title: '数据与复习调度',
    desc: '基于 FSRS 记忆算法安排复习，首页「即将复习」告诉你今天该背什么。',
    points: ['数据页展示趋势、日历、弱点与成就', '每日一句抽取合格句，形成句子级记忆', '登录后可同步、签到并参与排行榜'],
  },
];

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    steps: STEPS,
    total: STEPS.length,
    current: 0,
    isLast: false,
  },

  onLoad() {
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  onPrev() {
    const current = Math.max(0, this.data.current - 1);
    this.setData({ current, isLast: current === this.data.total - 1 });
  },

  onNext() {
    if (this.data.current >= this.data.total - 1) {
      this.finish();
      return;
    }
    const current = this.data.current + 1;
    this.setData({ current, isLast: current === this.data.total - 1 });
  },

  onSkip() {
    this.finish();
  },

  /** 完成引导：写标记并回到首页 */
  finish() {
    try {
      updateSettings({ onboardingSeen: true });
    } catch (e) {
      console.error('[onboarding] 写入引导标记失败', e);
    }
    wx.switchTab({ url: '/pages/home/index' });
  },
});