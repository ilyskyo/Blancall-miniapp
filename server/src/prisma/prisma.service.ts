import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Prisma 客户端（全局单例） */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('数据库连接成功');
    } catch (e) {
      this.logger.error(`数据库连接失败：${(e as Error).message}`);
      throw e;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}