/**
 * 错误类型与平台判断（原 wx.request 传输层已由 WorkBuddy 云服务 SDK 取代）
 */

export interface ApiError {
  code: string;
  message: string;
  detail?: unknown;
}

export class ApiException extends Error {
  code: string;
  detail?: unknown;
  constructor(err: ApiError) {
    super(err.message);
    this.code = err.code;
    this.detail = err.detail;
  }
}

const ERROR_TEXT: Record<string, string> = {
  UNAUTHORIZED: '登录已过期，请重新登录',
  AI_DISABLED: 'AI 功能未上线，敬请期待',
  SPACE_QUOTA_EXCEEDED: '云空间不足，请扩容',
  EXPORT_UNAVAILABLE: '该导出功能即将上线',
  UPSTREAM_FAILED: '服务繁忙，请稍后重试',
  INVALID_ARGUMENT: '参数有误',
  NOT_SUPPORTED: '暂不支持该格式或操作',
  NETWORK_ERROR: '网络异常，请检查网络后重试',
  TIMEOUT: '请求超时，请稍后重试',
  NOT_FOUND: '请求的内容不存在或已被删除',
  FORBIDDEN: '没有权限执行该操作',
  INTERNAL_ERROR: '服务异常，请稍后重试',
};

export function readableError(code: string, fallback?: string): string {
  return ERROR_TEXT[code] || fallback || '操作失败，请稍后重试';
}

export function currentPlatform(): 'ios' | 'android' | 'devtools' {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    const p = (info as { platform?: string }).platform || '';
    if (p === 'ios') return 'ios';
    if (p === 'android') return 'android';
    return 'devtools';
  } catch {
    return 'devtools';
  }
}
