"use strict";
/**
 * 遮罩配置列表：新建（输入名称）/ 编辑 / 删除 / 选中生效（需 occlusion_custom 权益）
 * 选中项通过 selectMaskConfig 持久化，阅读模式读取 activeMaskConfig。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const theme_1 = require("../../../../core/theme/theme");
const entities_1 = require("../../../../core/storage/entities");
const digest_1 = require("../../../../core/utils/digest");
const uuid_1 = require("../../../../core/utils/uuid");
const indexLogic_1 = require("./indexLogic");
let offTheme = null;
Page({
    data: {
        themeStyle: '',
        articleUuid: '',
        articleTitle: '',
        /** 限时免费活动：展示灰色小按键 */
        rightText: '新建',
        configs: [],
    },
    onLoad(query) {
        const articleUuid = query.articleUuid || '';
        const article = entities_1.articleStore.find(articleUuid);
        if (!article) {
            wx.showToast({ title: '文章不存在', icon: 'none' });
            setTimeout(() => wx.navigateBack(), 800);
            return;
        }
        this.setData({ themeStyle: (0, theme_1.themeStyle)(), articleUuid, articleTitle: article.title });
        offTheme = (0, theme_1.onThemeChange)((style) => this.setData({ themeStyle: style }));
        this.reload();
    },
    onShow() {
        if (this.data.articleUuid)
            this.reload();
    },
    onUnload() {
        if (offTheme) {
            offTheme();
            offTheme = null;
        }
    },
    reload() {
        this.setData({ configs: (0, indexLogic_1.buildMaskRows)((0, entities_1.maskConfigsOfArticle)(this.data.articleUuid)) });
    },
    // ============================== 操作 ==============================
    onNew() {
        const article = entities_1.articleStore.find(this.data.articleUuid);
        if (!article)
            return;
        wx.showModal({
            title: '新建遮罩配置',
            editable: true,
            placeholderText: '配置名称',
            content: '',
            success: (res) => {
                if (!res.confirm)
                    return;
                const name = (res.content || '').trim();
                if (!name) {
                    wx.showToast({ title: '请输入名称', icon: 'none' });
                    return;
                }
                try {
                    const list = (0, entities_1.maskConfigsOfArticle)(this.data.articleUuid);
                    const entity = {
                        uuid: (0, uuid_1.uuidv7)(),
                        articleUuid: this.data.articleUuid,
                        name,
                        createdAt: Date.now(),
                        contentHash: (0, digest_1.md5Hex)(article.content),
                        spans: [],
                        selected: list.length === 0,
                        updatedAt: Date.now(),
                    };
                    entities_1.maskConfigStore.upsert(entity);
                    wx.navigateTo({
                        url: `/packages/tools/pages/mask-edit/index?articleUuid=${this.data.articleUuid}&configId=${entity.uuid}`,
                    });
                }
                catch (err) {
                    wx.showToast({ title: err instanceof Error ? err.message : '创建失败', icon: 'none' });
                }
            },
        });
    },
    onEdit(e) {
        const configId = String(e.currentTarget.dataset.uuid);
        wx.navigateTo({
            url: `/packages/tools/pages/mask-edit/index?articleUuid=${this.data.articleUuid}&configId=${configId}`,
        });
    },
    onSelect(e) {
        const uuid = String(e.currentTarget.dataset.uuid);
        try {
            (0, entities_1.selectMaskConfig)(this.data.articleUuid, uuid);
            this.reload();
            wx.showToast({ title: '已设为阅读生效配置', icon: 'none' });
        }
        catch (err) {
            wx.showToast({ title: err instanceof Error ? err.message : '设置失败', icon: 'none' });
        }
    },
    onDelete(e) {
        const uuid = String(e.currentTarget.dataset.uuid);
        const config = (0, entities_1.maskConfigsOfArticle)(this.data.articleUuid).find((c) => c.uuid === uuid);
        if (!config)
            return;
        wx.showModal({
            title: '删除配置',
            content: `确定删除「${config.name}」？该操作不可撤销。`,
            confirmText: '删除',
            confirmColor: '#E5484D',
            success: (res) => {
                if (!res.confirm)
                    return;
                try {
                    entities_1.maskConfigStore.remove(uuid);
                    const rest = (0, entities_1.maskConfigsOfArticle)(this.data.articleUuid);
                    if (config.selected && rest.length > 0)
                        (0, entities_1.selectMaskConfig)(this.data.articleUuid, rest[0].uuid);
                    this.reload();
                    wx.showToast({ title: '已删除', icon: 'none' });
                }
                catch (err) {
                    wx.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' });
                }
            },
        });
    },
    onShowLock() {
        this.setData({ lockVisible: true });
    },
    onLockClose() {
        this.setData({ lockVisible: false });
    },
});
