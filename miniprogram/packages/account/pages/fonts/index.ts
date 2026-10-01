/**
 * 我的字体：上传 / 列表 / 删除 / 预览 / 设为阅读字体
 * 仅个人使用，请勿上传未获授权的字体。
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { login } from '../../../../core/net/auth';
import { isLoggedIn } from '../../../../core/storage/prefs';
import {
  chooseFontFile,
  errorText,
  loadFontFace,
  rememberFont,
  removeFont,
  syncMyFonts,
  uploadFont,
} from '../../../../core/upload';

let offTheme: (() => void) | null = null;

const SAMPLE_TEXT = 'Blancall 让背诵更高效：野芳发而幽香，佳木秀而繁阴。';
const PREVIEW_FAMILY = 'BlancallPreview';

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

interface FontRow {
  id: string;
  family: string;
  url: string;
  sizeText: string;
}

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    loggedIn: false,
    loading: false,
    uploading: false,
    fonts: [] as FontRow[],
    previewFamily: PREVIEW_FAMILY,
    previewText: SAMPLE_TEXT,
    previewingId: '',
  },

  onLoad() {
    this.__destroyed = false;
    this.setData({ themeStyle: themeStyle() });
    if (offTheme) offTheme();
    offTheme = onThemeChange((style: string) => this.setData({ themeStyle: style }));
  },

  onShow() {
    const loggedIn = isLoggedIn();
    this.setData({ loggedIn });
    if (loggedIn) void this.load();
    else this.setData({ fonts: [] });
  },

  onUnload() {
    this.__destroyed = true;
    if (offTheme) {
      offTheme();
      offTheme = null;
    }
  },

  async load() {
    this.setData({ loading: true });
    try {
      const list = await syncMyFonts();
      if (this.__destroyed) return;
      this.setData({
        fonts: list.map((f) => ({ id: f.id, family: f.family, url: f.url, sizeText: fmtSize(f.size) })),
      });
    } catch (e) {
      wx.showToast({ title: errorText(e), icon: 'none' });
    } finally {
      if (!this.__destroyed) this.setData({ loading: false });
    }
  },

  async onGoLogin() {
    try {
      await login();
      if (this.__destroyed) return;
      this.setData({ loggedIn: true });
      void this.load();
    } catch (e) {
      wx.showToast({ title: errorText(e), icon: 'none' });
    }
  },

  async onUpload() {
    if (!isLoggedIn()) {
      this.onGoLogin();
      return;
    }
    if (this.data.uploading) return;
    try {
      const path = await chooseFontFile();
      this.setData({ uploading: true });
      wx.showLoading({ title: '上传中', mask: true });
      await uploadFont(path);
      wx.hideLoading();
      wx.showToast({ title: '字体已上传', icon: 'success' });
      await this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: errorText(e), icon: 'none' });
    } finally {
      if (!this.__destroyed) this.setData({ uploading: false });
    }
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    const family = String(e.currentTarget.dataset.family || '');
    if (!id) return;
    wx.showModal({
      title: '删除字体',
      content: `确定删除「${family}」？删除后将释放云空间。`,
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        void removeFont(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'none' });
            return this.load();
          })
          .catch((err: unknown) => wx.showToast({ title: errorText(err), icon: 'none' }));
      },
    });
  },

  async onPreview(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    const family = String(e.currentTarget.dataset.family || '');
    const url = String(e.currentTarget.dataset.url || '');
    if (!family || !url) return;
    try {
      await loadFontFace(family, url);
      if (this.__destroyed) return;
      this.setData({ previewFamily: family, previewingId: id });
    } catch (err) {
      wx.showToast({ title: errorText(err), icon: 'none' });
    }
  },

  onSetReading(e: WechatMiniprogram.TouchEvent) {
    const family = String(e.currentTarget.dataset.family || '');
    if (!family) return;
    rememberFont(family);
    wx.showToast({ title: `已设为阅读字体：${family}`, icon: 'none' });
  },
});