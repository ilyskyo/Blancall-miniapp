"use strict";
Component({
    options: { addGlobalClass: true },
    properties: {
        icon: { type: String, value: '📄' },
        text: { type: String, value: '暂无内容' },
        actionText: { type: String, value: '' },
    },
    methods: {
        onAction() {
            this.triggerEvent('action');
        },
    },
});
