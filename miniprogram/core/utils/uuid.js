"use strict";
/**
 * UUIDv7 生成（客户端主键；替代 Android 端的自增 id）
 *
 * 结构：48 位毫秒时间戳 + 4 位版本(7) + 12 位 rand_a + 2 位变体(10) + 62 位 rand_b
 * 优点：时间有序，便于云同步增量拉取与本地索引。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.newDeviceId = exports.shortId = exports.uuidv7 = void 0;
let fallbackCounter = Math.floor(Math.random() * 0x1000);
function randomBytes(n) {
    const buf = new Uint8Array(n);
    const g = globalThis;
    if (g.wx && typeof g.wx.getRandomValues === 'function') {
        try {
            g.wx.getRandomValues(buf);
            return buf;
        }
        catch {
            /* 兜底到 Math.random */
        }
    }
    for (let i = 0; i < n; i++)
        buf[i] = Math.floor(Math.random() * 256);
    return buf;
}
function toHex(buf) {
    let out = '';
    for (let i = 0; i < buf.length; i++)
        out += buf[i].toString(16).padStart(2, '0');
    return out;
}
/** 生成 UUIDv7（小写带连字符） */
function uuidv7(now = Date.now()) {
    const rand = randomBytes(10);
    const randA = ((rand[0] & 0x0f) << 8) | rand[1];
    const timeHex = now.toString(16).padStart(12, '0').slice(-12);
    const versionNibble = '7';
    const variant = ((rand[2] & 0x3f) | 0x80).toString(16).padStart(2, '0');
    const rest = toHex(rand.slice(3, 10));
    return (`${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-${versionNibble}${randA
        .toString(16)
        .padStart(3, '0')}-${variant}${rest.slice(0, 2)}-${rest.slice(2, 14)}`);
}
exports.uuidv7 = uuidv7;
/** 简单自增短 id（仅用于卡片等非同步场景） */
function shortId() {
    fallbackCounter = (fallbackCounter + 1) % 0x1000;
    return `${Date.now().toString(36)}${fallbackCounter.toString(36).padStart(3, '0')}`;
}
exports.shortId = shortId;
/** 设备 id（本地生成一次并持久化） */
function newDeviceId() {
    return `d_${uuidv7().replace(/-/g, '').slice(0, 20)}`;
}
exports.newDeviceId = newDeviceId;
