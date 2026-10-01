import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { signLocalKey } from './signature.util';
import type { SignedUrl, StorageService } from './storage.interface';

/**
 * 本地磁盘存储（默认开发用）
 * 签名 URL 指向本服务的 /api/v1/files/raw，由 FilesController 校验签名后回传文件。
 */
@Injectable()
export class LocalStorageService implements StorageService {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.root = path.resolve(this.cfg.storage.localDir);
  }

  /** 解析绝对路径并阻止目录穿越 */
  resolvePath(key: string): string {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = path.resolve(this.root, normalized);
    if (!full.startsWith(this.root)) {
      throw new Error(`非法的存储 key：${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolvePath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // 写临时文件 → 原子替换，避免半写
    const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  async getSignedUrl(key: string, ttlSec?: number): Promise<SignedUrl> {
    const ttl = ttlSec ?? this.cfg.storage.signedUrlTtlSec;
    const exp = Date.now() + ttl * 1000;
    const sig = signLocalKey(this.cfg.storage.urlSecret, key, exp);
    const url =
      `${this.cfg.publicBaseUrl}/api/v1/files/raw` +
      `?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
    return { url, expireAt: exp };
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolvePath(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}