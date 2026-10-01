Component({
  options: { addGlobalClass: true },
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onToggle() {
      if (this.data.disabled) return;
      const next = !this.data.checked;
      this.setData({ checked: next });
      this.triggerEvent('change', { checked: next });
      wx.vibrateShort?.({ type: 'light' });
    },
  },
});