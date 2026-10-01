"use strict";
/**
 * 隐私授权弹窗（微信《关于小程序隐私保护指引设置的公告》适配）
 *
 * - 监听 wx.onNeedPrivacyAuthorization：用户首次触发隐私接口
 *   （头像昵称 / 选文件 / 存相册 / 剪贴板）时由基础库回调到这里
 * - 同意：button open-type="agreePrivacyAuthorization" 触发回调后
 *   resolve({ buttonId, event: 'agree' })，隐私接口继续执行
 * - 拒绝：resolve({ event: 'disagree' })，接口失败并由调用方的
 *   fail 分支提示
 * - 未挂载本组件的页面由平台官方隐私弹窗兜底（二选一，互不影响）
 */
Component({
    data: {
        show: false,
    },
    lifetimes: {
        attached() {
            const api = wx;
            if (!api.onNeedPrivacyAuthorization)
                return; // 低版本基础库：走平台官方弹窗
            api.onNeedPrivacyAuthorization((resolve) => {
                this._privacyResolve = resolve;
                this.setData({ show: true });
            });
        },
        detached() {
            const api = wx;
            if (api.offNeedPrivacyAuthorization)
                api.offNeedPrivacyAuthorization();
        },
    },
    methods: {
        /** 用户点「同意」：基础库先触发 bindagreeprivacyauthorization，再在此放行 */
        onAgree() {
            const self = this;
            this.setData({ show: false });
            if (self._privacyResolve) {
                self._privacyResolve({ buttonId: 'agree-btn', event: 'agree' });
                self._privacyResolve = undefined;
            }
        },
        onDisagree() {
            const self = this;
            this.setData({ show: false });
            if (self._privacyResolve) {
                self._privacyResolve({ event: 'disagree' });
                self._privacyResolve = undefined;
            }
        },
        onOpenContract() {
            wx.openPrivacyContract({
                fail: () => wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' }),
            });
        },
    },
});
