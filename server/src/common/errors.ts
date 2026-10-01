/**
 * 统一错误码表（docs/02-接口规范.md §0）+ 少量必要扩展码
 * 扩展码：NOT_FOUND / FORBIDDEN / INTERNAL_ERROR（规范未定义但 HTTP 语义需要）
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_FEATURE'
  | 'AI_BUDGET_EXCEEDED'
  | 'SPACE_QUOTA_EXCEEDED'
  | 'IOS_VIRTUAL_PAY_FORBIDDEN'
  | 'PAYMENT_NOT_CONFIGURED'
  | 'UPSTREAM_FAILED'
  | 'INVALID_ARGUMENT'
  | 'CONTENT_REJECTED'
  | 'SYNC_CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

/** 默认可读文案 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: '未登录或会话已过期',
  FORBIDDEN_FEATURE: '该功能需要开通会员或对应订阅',
  AI_BUDGET_EXCEEDED: '今日 AI 服务已达平台上限，请明日再试',
  SPACE_QUOTA_EXCEEDED: '云空间不足',
  IOS_VIRTUAL_PAY_FORBIDDEN: 'iOS 端暂不支持购买虚拟商品，请在安卓或电脑端完成',
  PAYMENT_NOT_CONFIGURED: '支付商户号未配置，暂时无法下单',
  UPSTREAM_FAILED: '上游服务暂时不可用，请稍后重试',
  INVALID_ARGUMENT: '参数校验失败',
  CONTENT_REJECTED: '内容未通过安全检测',
  SYNC_CONFLICT: '同步冲突',
  NOT_FOUND: '资源不存在',
  FORBIDDEN: '没有权限执行该操作',
  INTERNAL_ERROR: '服务器内部错误',
};

/** 错误码 → HTTP 状态码 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN_FEATURE: 403,
  FORBIDDEN: 403,
  IOS_VIRTUAL_PAY_FORBIDDEN: 403,
  AI_BUDGET_EXCEEDED: 429,
  SPACE_QUOTA_EXCEEDED: 413,
  PAYMENT_NOT_CONFIGURED: 503,
  UPSTREAM_FAILED: 502,
  INVALID_ARGUMENT: 400,
  CONTENT_REJECTED: 422,
  SYNC_CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

/** 业务异常：由统一异常过滤器转为 { ok:false, code, message, ...details } */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>, httpStatus?: number) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus ?? STATUS_BY_CODE[code];
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static unauthorized(message?: string, details?: Record<string, unknown>): AppError {
    return new AppError('UNAUTHORIZED', message, details);
  }
  static forbiddenFeature(missing: string[], message?: string): AppError {
    return new AppError('FORBIDDEN_FEATURE', message, { missing });
  }
  static forbidden(message?: string): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message?: string): AppError {
    return new AppError('NOT_FOUND', message);
  }
  static invalidArgument(message?: string, details?: Record<string, unknown>): AppError {
    return new AppError('INVALID_ARGUMENT', message, details);
  }
  static aiBudgetExceeded(budget: number, used: number): AppError {
    return new AppError('AI_BUDGET_EXCEEDED', undefined, { budget, used });
  }
  static spaceQuotaExceeded(need: number, used: number, total: number): AppError {
    return new AppError('SPACE_QUOTA_EXCEEDED', undefined, { need, used, total });
  }
  static iosVirtualPayForbidden(): AppError {
    return new AppError('IOS_VIRTUAL_PAY_FORBIDDEN');
  }
  static paymentNotConfigured(message?: string): AppError {
    return new AppError('PAYMENT_NOT_CONFIGURED', message);
  }
  static upstreamFailed(message?: string): AppError {
    return new AppError('UPSTREAM_FAILED', message);
  }
  static contentRejected(message?: string): AppError {
    return new AppError('CONTENT_REJECTED', message);
  }
  static syncConflict(serverRev: number, serverUpdatedAt: number): AppError {
    return new AppError('SYNC_CONFLICT', undefined, { serverRev, serverUpdatedAt });
  }
}