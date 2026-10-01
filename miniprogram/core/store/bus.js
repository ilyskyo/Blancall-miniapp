"use strict";
/**
 * 极简全局事件总线（页面间刷新通知；不引入第三方状态库以控制主包体积）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.unbindPageEvents = exports.bindPageEvents = exports.emit = exports.on = exports.EVT = void 0;
exports.EVT = {
    articlesChanged: 'articles:changed',
    recordsChanged: 'records:changed',
    tagsChanged: 'tags:changed',
    settingsChanged: 'settings:changed',
    entitlementsChanged: 'entitlements:changed',
    syncFinished: 'sync:finished',
    homeLayoutChanged: 'home:layout',
};
const listeners = new Map();
function on(event, fn) {
    let set = listeners.get(event);
    if (!set) {
        set = new Set();
        listeners.set(event, set);
    }
    set.add(fn);
    return () => set && set.delete(fn);
}
exports.on = on;
function emit(event, payload) {
    const set = listeners.get(event);
    if (!set)
        return;
    set.forEach((fn) => {
        try {
            fn(payload);
        }
        catch (e) {
            console.error('[bus] listener error', event, e);
        }
    });
}
exports.emit = emit;
/** 页面卸载时统一解绑 */
function bindPageEvents(page, map) {
    const offs = [];
    Object.keys(map).forEach((evt) => offs.push(on(evt, map[evt])));
    page.__offs = offs;
}
exports.bindPageEvents = bindPageEvents;
function unbindPageEvents(page) {
    if (page.__offs) {
        page.__offs.forEach((off) => off());
        page.__offs = [];
    }
}
exports.unbindPageEvents = unbindPageEvents;
