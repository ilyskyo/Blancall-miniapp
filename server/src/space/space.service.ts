import { Injectable } from '@nestjs/common';
import { FREE_SPACE_BYTES } from '../common/features';
import { PrismaService } from '../prisma/prisma.service';

export interface SpaceUsage {
  usedBytes: number;
  totalBytes: number;
}

@Injectable()
export class SpaceService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /space/usage —— 当前用户空间用量（完全免费，统一额度） */
  async usage(userId: string): Promise<SpaceUsage> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return {
      usedBytes: user ? Number(user.spaceBytesUsed) : 0,
      totalBytes: FREE_SPACE_BYTES,
    };
  }
}
