import type { AuthRequest } from './types';

/** 从 Authorization: Bearer <token> 中取出 token */
export function extractBearer(req: AuthRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const idx = header.indexOf(' ');
  if (idx < 0) return undefined;
  const scheme = header.slice(0, idx).toLowerCase();
  const value = header.slice(idx + 1).trim();
  if (scheme !== 'bearer' || value === '') return undefined;
  return value;
}

/** 管理员令牌：优先 X-Admin-Token，其次 Bearer */
export function extractAdminToken(req: AuthRequest): string | undefined {
  const headerValue = req.headers['x-admin-token'];
  if (typeof headerValue === 'string' && headerValue.trim() !== '') return headerValue.trim();
  return extractBearer(req);
}