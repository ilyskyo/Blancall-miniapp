"use strict";
/**
 * 纯 TypeScript 摘要算法（无依赖）
 *
 * 用途（与 Android 端严格一致）：
 * - md5Hex：文章内容指纹（ContentFingerprint.md5Hex）
 * - sha256Hex：句子键哈希（SentenceSelector.sentenceKey → SHA-256 前 8 字节 hex）
 * - hash16：取 SHA-256 前 8 字节的 hex（16 个 hex 字符）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash16 = exports.sha256Hex = exports.sha256Bytes = exports.md5Hex = exports.md5Bytes = exports.utf8Bytes = void 0;
/** 字符串 → UTF-8 字节数组（兼容代理对） */
function utf8Bytes(input) {
    const bytes = [];
    for (let i = 0; i < input.length; i++) {
        let code = input.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
            const next = input.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
                i++;
            }
        }
        if (code < 0x80) {
            bytes.push(code);
        }
        else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        }
        else if (code < 0x10000) {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
        else {
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return bytes;
}
exports.utf8Bytes = utf8Bytes;
function toHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += (bytes[i] & 0xff).toString(16).padStart(2, '0');
    }
    return out;
}
function rotl(x, c) {
    return ((x << c) | (x >>> (32 - c))) >>> 0;
}
function rotr(x, c) {
    return ((x >>> c) | (x << (32 - c))) >>> 0;
}
// ============================== MD5 ==============================
const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
let md5KCache = null;
function md5K() {
    if (!md5KCache) {
        const k = new Uint32Array(64);
        for (let i = 0; i < 64; i++) {
            k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
        }
        md5KCache = k;
    }
    return md5KCache;
}
/** MD5（返回 16 字节） */
function md5Bytes(input) {
    const msg = typeof input === 'string' ? utf8Bytes(input) : input.slice();
    const bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56)
        msg.push(0);
    // 64 位小端长度（JS 数字精度有限，按 32 位高低拆）
    const hi = Math.floor(bitLen / 4294967296);
    const lo = bitLen >>> 0;
    msg.push(lo & 0xff, (lo >>> 8) & 0xff, (lo >>> 16) & 0xff, (lo >>> 24) & 0xff);
    msg.push(hi & 0xff, (hi >>> 8) & 0xff, (hi >>> 16) & 0xff, (hi >>> 24) & 0xff);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const K = md5K();
    for (let off = 0; off < msg.length; off += 64) {
        const M = new Uint32Array(16);
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4;
            M[i] = (msg[j] | (msg[j + 1] << 8) | (msg[j + 2] << 16) | (msg[j + 3] << 24)) >>> 0;
        }
        let A = a0;
        let B = b0;
        let C = c0;
        let D = d0;
        for (let i = 0; i < 64; i++) {
            let F = 0;
            let g = 0;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            }
            else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            }
            else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            }
            else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + rotl(F, MD5_S[i])) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }
    const out = [];
    const pushLe = (v) => {
        out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    };
    pushLe(a0);
    pushLe(b0);
    pushLe(c0);
    pushLe(d0);
    return out;
}
exports.md5Bytes = md5Bytes;
/** MD5 hex（等同 Android ContentFingerprint.md5Hex） */
function md5Hex(input) {
    return toHex(md5Bytes(input));
}
exports.md5Hex = md5Hex;
// ============================== SHA-256 ==============================
const SHA256_K_HEX = [
    '428a2f98', '71374491', 'b5c0fbcf', 'e9b5dba5', '3956c25b', '59f111f1', '923f82a4', 'ab1c5ed5',
    'd807aa98', '12835b01', '243185be', '550c7dc3', '72be5d74', '80deb1fe', '9bdc06a7', 'c19bf174',
    'e49b69c1', 'efbe4786', '0fc19dc6', '240ca1cc', '2de92c6f', '4a7484aa', '5cb0a9dc', '76f988da',
    '983e5152', 'a831c66d', 'b00327c8', 'bf597fc7', 'c6e00bf3', 'd5a79147', '06ca6351', '14292967',
    '27b70a85', '2e1b2138', '4d2c6dfc', '53380d13', '650a7354', '766a0abb', '81c2c92e', '92722c85',
    'a2bfe8a1', 'a81a664b', 'c24b8b70', 'c76c51a3', 'd192e819', 'd6990624', 'f40e3585', '106aa070',
    '19a4c116', '1e376c08', '2748774c', '34b0bcb5', '391c0cb3', '4ed8aa4a', '5b9cca4f', '682e6ff3',
    '748f82ee', '78a5636f', '84c87814', '8cc70208', '90befffa', 'a4506ceb', 'bef9a3f7', 'c67178f2',
];
let shaKCache = null;
function sha256K() {
    if (!shaKCache) {
        const k = new Uint32Array(64);
        for (let i = 0; i < 64; i++)
            k[i] = parseInt(SHA256_K_HEX[i], 16) >>> 0;
        shaKCache = k;
    }
    return shaKCache;
}
/** SHA-256（返回 32 字节） */
function sha256Bytes(input) {
    const msg = typeof input === 'string' ? utf8Bytes(input) : input.slice();
    const bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56)
        msg.push(0);
    const hi = Math.floor(bitLen / 4294967296);
    const lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    msg.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
    const H = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const K = sha256K();
    const w = new Uint32Array(64);
    for (let off = 0; off < msg.length; off += 64) {
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4;
            w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15];
            const y = w[i - 2];
            const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
            const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = H[0];
        let b = H[1];
        let c = H[2];
        let d = H[3];
        let e = H[4];
        let f = H[5];
        let g = H[6];
        let h = H[7];
        for (let i = 0; i < 64; i++) {
            const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
            const ch = ((e & f) ^ (~e & g)) >>> 0;
            const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
            const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            const temp2 = (S0 + maj) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0;
        H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0;
        H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0;
        H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0;
        H[7] = (H[7] + h) >>> 0;
    }
    const out = [];
    for (let i = 0; i < 8; i++) {
        const v = H[i];
        out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    }
    return out;
}
exports.sha256Bytes = sha256Bytes;
/** SHA-256 hex（小写） */
function sha256Hex(input) {
    return toHex(sha256Bytes(input));
}
exports.sha256Hex = sha256Hex;
/**
 * 句子键哈希：SHA-256(text.trim()) 的前 8 字节 hex（16 个 hex 字符）
 * 对应 Android `SentenceSelector.sentenceKey` 内的 hash16
 */
function hash16(text) {
    const digest = sha256Bytes(text.trim());
    let out = '';
    for (let i = 0; i < 8; i++)
        out += digest[i].toString(16).padStart(2, '0');
    return out;
}
exports.hash16 = hash16;
