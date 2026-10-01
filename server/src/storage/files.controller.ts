import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { Public, SkipResponseWrap } from '../common/decorators';
import { LocalStorageService } from './local-storage.service';
import { contentTypeByExt, extOfKey, verifyLocalKey } from './signature.util';

/**
 * 本地存储的签名下载入口（STORAGE_DRIVER=local 时使用）
 * URL 由 LocalStorageService.getSignedUrl 生成，有效期 ≤ 10 分钟。
 */
@Controller('files')
export class FilesController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly localStorage: LocalStorageService,
  ) {}

  @Public()
  @SkipResponseWrap()
  @Get('raw')
  async raw(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!key || !exp || !sig) throw AppError.invalidArgument('缺少签名参数');
    const expMs = Number.parseInt(exp, 10);
    if (!verifyLocalKey(this.cfg.storage.urlSecret, key, expMs, sig)) {
      throw AppError.forbidden('下载链接无效或已过期');
    }

    let data: Buffer;
    try {
      data = await this.localStorage.get(key);
    } catch {
      throw AppError.notFound('文件不存在');
    }

    res.setHeader('Content-Type', contentTypeByExt(extOfKey(key)));
    res.setHeader('Cache-Control', 'private, max-age=300');
    // 字体经 wx.loadFontFace 加载需要跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(data);
  }
}