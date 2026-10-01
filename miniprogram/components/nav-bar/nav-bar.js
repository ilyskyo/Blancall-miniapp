"use strict";
/**
 * 自定义导航栏（全局 navigationStyle: custom）
 * 规范：返回按钮外边距 20dp；标题 headlineMedium（34rpx）
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../core/theme/theme");
Component({
    options: { addGlobalClass: true, multipleSlots: true },
    properties: {
        title: { type: String, value: '' },
        /** 是否显示返回按钮（默认自动判断：非首个页面） */
        showBack: { type: Boolean, value: true },
        /** 是否显示右文按钮 */
        rightText: { type: String, value: '' },
        /** 标题是否居中 */
        center: { type: Boolean, value: false },
        /** 是否固定定位 */
        fixed: { type: Boolean, value: true },
        /** 是否显示底部分隔线 */
        bordered: { type: Boolean, value: false },
        /** 是否插入占位（fixed 时避免内容被遮挡） */
        placeholder: { type: Boolean, value: true },
    },
    data: {
        statusBarHeight: 20,
        bg: 'transparent',
    },
    lifetimes: {
        attached() {
            const pages = getCurrentPages();
            this.setData({
                statusBarHeight: (0, theme_1.statusBarHeight)(),
                bg: (0, theme_1.themeStyle)().indexOf('--bg:#000000') >= 0 ? '#000000' : 'transparent',
            });
            if (!this.data.showBack && pages.length > 1) {
                this.setData({ showBack: true });
            }
            else if (pages.length <= 1) {
                this.setData({ showBack: false });
            }
        },
    },
    methods: {
        onBack() {
            const pages = getCurrentPages();
            if (pages.length > 1)
                wx.navigateBack({ delta: 1 });
            else
                wx.switchTab({ url: '/pages/home/index' });
        },
        onRightTap() {
            this.triggerEvent('righttap');
        },
        /** 供页面调用：随主题刷新 */
        applyTheme(style) {
            const dark = style.indexOf('--bg:#000000') >= 0;
            this.setData({ bg: dark ? '#000000' : 'transparent' });
            void (0, theme_1.navTextColor)();
        },
    },
});
