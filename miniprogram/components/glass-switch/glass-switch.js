"use strict";
Component({
    options: { addGlobalClass: true },
    properties: {
        checked: { type: Boolean, value: false },
        disabled: { type: Boolean, value: false },
    },
    methods: {
        onToggle() {
            var _a;
            if (this.data.disabled)
                return;
            const next = !this.data.checked;
            this.setData({ checked: next });
            this.triggerEvent('change', { checked: next });
            (_a = wx.vibrateShort) === null || _a === void 0 ? void 0 : _a.call(wx, { type: 'light' });
        },
    },
});
