/**
 * 功能提示浮层（当前仅用于「AI 功能未上线」的统一提示）
 * 原「付费功能锁定 + 购买引导」逻辑已随付费体系移除。
 */

Component({
  options: { addGlobalClass: true },
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: 'AI 功能未上线' },
    desc: { type: String, value: 'AI 功能正在准备中，敬请期待。基础背诵功能不受影响。' },
    ctaText: { type: String, value: '知道了' },
  },
  methods: {
    noop() {
      /* 阻断底层点击 */
    },
    onClose() {
      this.triggerEvent('close');
    },
  },
});
