import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import { WechatAuthService } from '../wechat/wechat-auth.service';
import { toUserView, type PatchMeBody, type UserView } from './auth.dto';

export interface LoginResult {
  token: string;
  expiresAt: number;
  user: UserView;
  isNew: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly wechatAuth: WechatAuthService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  private sessionExpiry(): Date {
    return new Date(Date.now() + this.cfg.sessionTtlDays * 24 * 60 * 60 * 1000);
  }

  /** 登录：code2session → upsert 用户 → 建会话 */
  async login(code: string, platform: string): Promise<LoginResult> {
    const { openid, unionid } = await this.wechatAuth.code2Session(code);

    const existing = await this.prisma.user.findUnique({ where: { openid } });
    let isNew = false;

    const user = existing
      ? await this.prisma.user.update({
          where: { openid },
          data: unionid ? { unionid } : {},
        })
      : await (async () => {
          isNew = true;
          return this.prisma.user.create({
            data: {
              openid,
              unionid: unionid ?? null,
              // 默认不强制昵称/头像（合规最小化）
              nickname: '用户****',
              rankVisible: true,
            },
          });
        })();

    const token = randomBytes(32).toString('hex');
    const expiresAt = this.sessionExpiry();
    await this.prisma.session.create({
      data: { token, userId: user.id, expiresAt },
    });

    this.logger.log(`登录成功 userId=${user.id} platform=${platform} isNew=${isNew}`);

    return { token, expiresAt: expiresAt.getTime(), user: toUserView(user), isNew };
  }

  /** 续期（沿用当前 token） */
  async refresh(userId: string, token: string): Promise<{ token: string; expiresAt: number }> {
    const expiresAt = this.sessionExpiry();
    await this.prisma.session.update({ where: { token }, data: { expiresAt } });
    return { token, expiresAt: expiresAt.getTime() };
  }

  /** 注销会话（仅当前 token） */
  async logout(token: string): Promise<{ loggedOut: true }> {
    await this.prisma.session.deleteMany({ where: { token } });
    return { loggedOut: true };
  }

  getMe(userId: string): Promise<UserView> {
    return this.prisma.user
      .findUnique({ where: { id: userId } })
      .then((u) => {
        if (!u) throw AppError.notFound('用户不存在');
        return toUserView(u);
      });
  }

  async patchMe(userId: string, body: PatchMeBody): Promise<UserView> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
        ...(body.avatar !== undefined ? { avatar: body.avatar } : {}),
        ...(body.rankVisible !== undefined ? { rankVisible: body.rankVisible } : {}),
      },
    });
    return toUserView(user);
  }

  /**
   * 账号注销：物理删除该用户全部云端数据
   * - 先删除对象存储中的文件（uploads）
   * - 再删除 users 行，其余表通过外键 ON DELETE CASCADE 一并清除
   *   （entities / uploads / sessions / ai_* / checkins ...）
   */
  async deleteAccount(userId: string): Promise<{ deleted: true }> {
    const uploads = await this.prisma.upload.findMany({
      where: { userId },
      select: { storageKey: true },
    });
    for (const u of uploads) {
      try {
        await this.storage.delete(u.storageKey);
      } catch (e) {
        this.logger.warn(`注销时删除存储对象失败 key=${u.storageKey}: ${(e as Error).message}`);
      }
    }

    await this.prisma.user.delete({ where: { id: userId } });
    this.logger.log(`账号已注销 userId=${userId}`);
    return { deleted: true };
  }
}