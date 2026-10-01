import { createHmac, timingSafeEqual } from 'node:crypto';

/** 本地存储签名 URL 的签名串：HMAC-SHA256(secret, `${key}\n${exp}`) */
export function signLocalKey(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}\n${exp}`).digest('hex');
}

/** 校验本地存储签名 URL */
export function verifyLocalKey(secret: string, key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Date.now() > exp) return false;
  const expected = signLocalKey(secret, key, exp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 根据扩展名推断 Content-Type */
export function contentTypeByExt(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase();
  switch (e) {
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    case 'pdf':
      return 'application/pdf';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'md':
      return 'text/markdown; charset=utf-8';
    case 'html':
      return 'text/html; charset=utf-8';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** 存储 key → 扩展名 */
export function extOfKey(key: string): string {
  const idx = key.lastIndexOf('.');
  return idx < 0 ? '' : key.slice(idx + 1);
}