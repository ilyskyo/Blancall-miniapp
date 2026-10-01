/**
 * 协议页：隐私政策 / 用户协议（?type=privacy|terms）
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { AgreementSection, getAgreement, normalizeType } from './agreementLogic';

let offTheme: (() => void) | null = null;

Page({
  data: {
    themeStyle: '',
    title: '',
    updatedAt: '',
    sections: [] as AgreementSection[],
    contactEmail: 'blancall@163.com',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));

    const type = normalizeType(options && options.type ? options.type : '');
    const doc = getAgreement(type);
    this.setData({ title: doc.title, updatedAt: doc.updatedAt, sections: doc.sections });
  },

  onUnload() {
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  onCopyEmail() {
    wx.setClipboardData({ data: this.data.contactEmail });
  },
});