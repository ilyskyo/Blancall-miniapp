import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { FilesController } from './files.controller';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from './s3-storage.service';
import { STORAGE_SERVICE, type StorageService } from './storage.interface';

/** 对象存储模块：按 STORAGE_DRIVER 注入 local / s3 实现 */
@Module({
  controllers: [FilesController],
  providers: [
    LocalStorageService,
    S3StorageService,
    {
      provide: STORAGE_SERVICE,
      inject: [APP_CONFIG, LocalStorageService, S3StorageService],
      useFactory: (cfg: AppConfig, local: LocalStorageService, s3: S3StorageService): StorageService =>
        cfg.storage.driver === 's3' ? s3 : local,
    },
  ],
  exports: [STORAGE_SERVICE, LocalStorageService],
})
export class StorageModule {}