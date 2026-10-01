"use strict";
/**
 * 协议页：隐私政策 / 用户协议（?type=privacy|terms）
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const agreementLogic_1 = require("./agreementLogic");
let offTheme = null;
Page({
    data: {
        themeStyle: '',
        title: '',
        updatedAt: '',
        sections: [],
        contactEmail: 'blancall@163.com',
    },
    onLoad(options) {
        this.setData({ themeStyle: (0, theme_1.themeStyle)() });
        if (offTheme)
            offTheme();
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        const type = (0, agreementLogic_1.normalizeType)(options && options.type ? options.type : '');
        const doc = (0, agreementLogic_1.getAgreement)(type);
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
