/**
 * 帮助：导入 / 三种练习模式与提示 / 阅读与背诵遮挡 / 复习调度（FSRS）/ 数据与云同步 / 常见问题
 */

import { onThemeChange, themeStyle } from '../../core/theme/theme';

interface HelpSection {
  id: string;
  icon: string;
  title: string;
  items: string[];
  action?: string;
  actionText?: string;
}

interface Faq {
  q: string;
  a: string;
}

const SECTIONS: HelpSection[] = [
  {
    id: 'import',
    icon: '📥',
    title: '导入文章',
    items: [
      '首页搜索栏右侧「＋添加」或「我的文章」右上角「＋」进入导入页。',
      '粘贴文本：直接粘贴正文，可自动首行缩进（按空行分段补两个全角空格）。',
      '聊天文件：先把文件发送到微信「文件传输助手」，再在导入页选择。',
      'TXT / MD 在本机解析；PDF / DOC / DOCX / EPUB / RTF / HTML 需登录后由云端解析（即将上线）。',
      '若提示无法识别编码，请用记事本将文件另存为 UTF-8 后重试。',
    ],
  },
  {
    id: 'practice',
    icon: '✏️',
    title: '三种练习模式与提示',
    items: [
      '句子挖空：整句或半句挖空，适合理解与背诵。',
      '字词挖空：按字词粒度挖空，适合默写关键字眼。',
      '反向默写：给乱序线索，整段默写，按相似度评分。',
      '段落范围：全文 / 薄弱集训（自动挑错得多的段落）/ 自选段落。',
      '提示规则：10 秒无输入淡显下一个字；再静置 5 秒自动填入并继续下一个字；任意键入会重置计时（可在设置中关闭）。',
    ],
  },
  {
    id: 'reader',
    icon: '📖',
    title: '阅读模式与背诵遮挡',
    items: [
      '阅读按约 420 字分节，支持滚动与翻页两种布局，并记住阅读断点。',
      '字号、行距、字重、背景与字体可按文章独立设置。',
      '背诵遮挡：遮盖正文中的关键字词，点击遮块揭示、再点遮回。',
      '本地三粒度：短词（每分句最多 3 个高难字）、整句、混合伪随机。',
      '自定义遮挡可自选段落区间与颜色，在「数据 → 自定义遮挡」中创建配置。',
    ],
  },
  {
    id: 'review',
    icon: '🧠',
    title: '复习调度（FSRS）',
    items: [
      '每次练习完成后，按正确率给出评级（重来 / 困难 / 良好 / 容易）。',
      '系统用 FSRS 算法推算每篇文章与每句的遗忘曲线，安排下次复习时间。',
      '首页「即将复习」列出逾期与 3 天内到期的文章，按紧急度排序。',
      '可在设置中选择复习模板（冲刺 / 标准 / 深度），影响无 FSRS 状态时的间隔。',
    ],
  },
  {
    id: 'data',
    icon: '☁️',
    title: '数据与云同步',
    items: [
      '未登录时全部数据保存在本机，功能完整可用。',
      '登录后可云同步核心学习数据（文章、标签、记录、进度、FSRS、阅读偏好、首页布局与设置）。',
      '上传文档与自定义字体为云端能力，需登录且受云空间配额限制。',
      '同步在启动、关键操作后与退到后台时自动进行，也可在账户页手动同步。',
    ],
  },
];

const FAQS: Faq[] = [
  { q: '练习到一半退出会丢进度吗？', a: '不会。作答后退出会保存断点，重新进入可选择继续练习；完整提交后断点自动清除。' },
  { q: '可以导出我的数据吗？', a: '可以在设置的内容管理中导出练习记录与我的数据（JSON），用于备份或迁移。' },
  { q: '换设备后数据还在吗？', a: '登录同一账号后会从云端同步；未登录期间产生的数据在首次登录时会上传合并。' },
  { q: '深色模式下正文底色为什么是纯黑？', a: '为减少夜间阅读发光面积，深色模式统一使用纯黑背景；浅色可选米白或纯白。' },
];

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    sections: SECTIONS,
    faqs: FAQS,
    openId: 'import',
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

  onToggleSection(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    this.setData({ openId: this.data.openId === id ? '' : id });
  },



  onReplayOnboarding() {
    wx.navigateTo({ url: '/pages/onboarding/index' });
  },
});