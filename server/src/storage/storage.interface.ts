/**
 * 对象存储抽象
 * 实现：local（磁盘 + 静态签名 URL）/ s3（S3 兼容：COS/OSS/MinIO）
 */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export interface SignedUrl {
  url: string;
  /** 过期时间（毫秒时间戳） */
  expireAt: number;
}

export interface StorageService {
  /** 写入对象 */
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  /** 读取对象 */
  get(key: string): Promise<Buffer>;
  /** 生成带签名的下载 URL（有效期 ≤ 10 分钟，默认 600s） */
  getSignedUrl(key: string, ttlSec?: number): Promise<SignedUrl>;
  /** 删除对象（不存在时静默成功） */
  delete(key: string): Promise<void>;
}