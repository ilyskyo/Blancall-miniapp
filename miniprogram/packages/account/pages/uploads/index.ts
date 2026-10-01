/**
 * 我的云端资料：文档列表 / 解析状态 / 删除 / 导入到背诵
 */

import { onThemeChange, themeStyle } from '../../../../core/theme/theme';
import { UploadedDocument } from '../../../../core/net/api';
import { ApiException } from '../../../../core/net/request';
import { entitlementsSnapshot, login, requireLogin } from '../../../../core/net/auth';
import { isLoggedIn } from '../../../../core/storage/prefs';
import { errorText, listDocuments, reimport, removeDocument } from '../../../../core/upload';

let offTheme: (() => void) | null = null;

/** 保留原始文档对象（导入到背诵需要完整 doc） */
let docsRaw: UploadedDocument[] = [];

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

function statusInfo(status: UploadedDocument['status']): { text: string; cls: string } {
  if (status === 'parsed') return { text: '已解析', cls: 'doc-status--ok' };
  if (status === 'failed') return { text: '解析失败', cls: 'doc-status--fail' };
  return { text: '已上传', cls: 'doc-status--muted' };
}

interface DocRow {
  id: string;
  name: string;
  ext: string;
  sizeText: string;
  statusText: string;
  statusClass: string;
}

Page({
  /** 页面已销毁标记：异步回调中阻止 setData */
  __destroyed: false,

  data: {
    themeStyle: '',
    loggedIn: false,
    loading: false,
    docs: [] as DocRow[],
    spaceHint: '',
    importing: false,
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
    else this.setData({ docs: [], spaceHint: '' });
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
      docsRaw = await listDocuments();
      if (this.__destroyed) return;
      this.setData({
        docs: docsRaw.map((d) => {
          const s = statusInfo(d.status);
          return {
            id: d.id,
            name: d.name,
            ext: d.ext,
            sizeText: fmtSize(d.size),
            statusText: s.text,
            statusClass: s.cls,
          };
        }),
        spaceHint: this.computeSpaceHint(),
      });
    } catch (e) {
      wx.showToast({ title: errorText(e), icon: 'none' });
    } finally {
      if (!this.__destroyed) this.setData({ loading: false });
    }
  },

  /** 空间接近或超出配额时给出扩容引导 */
  computeSpaceHint(): string {
    const space = entitlementsSnapshot()?.space;
    if (!space || space.totalBytes <= 0) return '';
    const ratio = space.usedBytes / space.totalBytes;
    if (ratio >= 1) return '云空间已用满，需扩容后才能继续上传';
    if (ratio >= 0.85) return '云空间即将用满，建议提前扩容';
    return '';
  },

  onGoLogin() {
    void login()
      .then(() => {
        if (this.__destroyed) return;
        this.setData({ loggedIn: true });
        void this.load();
      })
      .catch((e: unknown) => wx.showToast({ title: errorText(e), icon: 'none' }));
  },

  onTapSpace() {
    wx.navigateTo({ url: '/packages/account/pages/space/index' });
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    const name = String(e.currentTarget.dataset.name || '');
    if (!id) return;
    wx.showModal({
      title: '删除云端资料',
      content: `确定删除「${name}」？删除后将释放云空间。`,
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        void removeDocument(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'none' });
            return this.load();
          })
          .catch((err: unknown) => {
            if (err instanceof ApiException && err.code === 'SPACE_QUOTA_EXCEEDED') this.onTapSpace();
            else wx.showToast({ title: errorText(err), icon: 'none' });
          });
      },
    });
  },

  async onImport(e: WechatMiniprogram.TouchEvent) {
    if (!requireLogin({})) return;
    const id = String(e.currentTarget.dataset.id || '');
    const doc = docsRaw.find((d) => d.id === id);
    if (!doc) return;
    if (this.data.importing) return;
    this.setData({ importing: true });
    wx.showLoading({ title: '解析中', mask: true });
    try {
      await reimport(doc);
      wx.hideLoading();
      wx.showModal({
        title: '导入成功',
        content: '已生成文章，可在「我的文章」中开始练习。',
        showCancel: false,
        confirmText: '去练习',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/list/index' });
        },
      });
      await this.load();
    } catch (err) {
      wx.hideLoading();
      if (err instanceof ApiException && err.code === 'SPACE_QUOTA_EXCEEDED') this.onTapSpace();
      else wx.showToast({ title: errorText(err), icon: 'none' });
    } finally {
      if (!this.__destroyed) this.setData({ importing: false });
    }
  },
});