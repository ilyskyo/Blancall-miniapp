/**
 * 极简全局事件总线（页面间刷新通知；不引入第三方状态库以控制主包体积）
 */

export const EVT = {
  articlesChanged: 'articles:changed',
  recordsChanged: 'records:changed',
  tagsChanged: 'tags:changed',
  settingsChanged: 'settings:changed',
  entitlementsChanged: 'entitlements:changed',
  syncFinished: 'sync:finished',
  homeLayoutChanged: 'home:layout',
} as const;

type Listener = (payload?: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export function on(event: string, fn: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => set && set.delete(fn);
}

export function emit(event: string, payload?: unknown): void {
  const set = listeners.get(event);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      console.error('[bus] listener error', event, e);
    }
  });
}

/** 页面实例的最小约束（避免依赖 WechatMiniprogram 泛型命名空间） */
export interface PageLike {
  __offs?: Array<() => void>;
  [key: string]: unknown;
}

/** 页面卸载时统一解绑 */
export function bindPageEvents(page: PageLike, map: Record<string, Listener>): void {
  const offs: Array<() => void> = [];
  Object.keys(map).forEach((evt) => offs.push(on(evt, map[evt])));
  page.__offs = offs;
}

export function unbindPageEvents(page: PageLike): void {
  if (page.__offs) {
    page.__offs.forEach((off) => off());
    page.__offs = [];
  }
}