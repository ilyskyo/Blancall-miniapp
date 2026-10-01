import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { SignedUrl, StorageService } from './storage.interface';

/**
 * S3 兼容对象存储（COS / OSS / MinIO）
 * 客户端懒初始化，未配置时不影响 local 驱动启动。
 */
@Injectable()
export class S3StorageService implements StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private client: S3Client | null = null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private get bucket(): string {
    return this.cfg.storage.s3.bucket;
  }

  private getClient(): S3Client {
    if (!this.client) {
      const s3 = this.cfg.storage.s3;
      this.client = new S3Client({
        region: s3.region,
        endpoint: s3.endpoint || undefined,
        forcePathStyle: s3.forcePathStyle,
        credentials: {
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
        },
      });
    }
    return this.client;
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.getClient().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (!body) throw new Error(`对象不存在：${key}`);
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getSignedUrl(key: string, ttlSec?: number): Promise<SignedUrl> {
    const ttl = ttlSec ?? this.cfg.storage.signedUrlTtlSec;
    const url = await awsGetSignedUrl(
      this.getClient(),
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttl },
    );
    return { url, expireAt: Date.now() + ttl * 1000 };
  }

  async delete(key: string): Promise<void> {
    await this.getClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}