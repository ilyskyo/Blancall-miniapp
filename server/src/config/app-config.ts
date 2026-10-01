/**
 * 类型化环境配置（单一入口）
 * 通过 `import 'dotenv/config'` 在模块加载时读取 .env（不存在则仅使用进程环境变量）。
 */
import 'dotenv/config';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface StorageConfig {
  driver: 'local' | 's3';
  localDir: string;
  urlSecret: string;
  signedUrlTtlSec: number;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
}

export interface WxConfig {
  appId: string;
  secret: string;
  /** 是否使用开发登录（WX_APPID 缺失时自动为 true） */
  devLogin: boolean;
}

export interface WxSecurityConfig {
  enabled: boolean;
  scene: number;
}

export interface WxSubscribeConfig {
  /** 学习提醒订阅消息模板 ID（公众平台申请）；未配置则跳过发送 */
  templateId: string;
}


export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** 全平台每日可消耗的 AI 卡总数（0 = 不限制） */
  dailyBudgetCards: number;
}

/**
 * 限时免费活动（运营开关）
 * - 打开后：5 个单项付费功能 + AI（不扣卡）在活动期内免费使用；购买/充值链路不受影响
 * - 建议在活动覆盖 AI 时同时设置 AI_DAILY_BUDGET_CARDS 控制平台成本
 */

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  sessionTtlDays: number;
  adminToken: string;
  storage: StorageConfig;
  wx: WxConfig;
  wxSecurity: WxSecurityConfig;
  wxSubscribe: WxSubscribeConfig;
  ai: AiConfig;
  gaokaoDir: string;
  exportTtlSec: number;
  leaderboardCron: string;
  timezone: string;
}

function str(key: string, def = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
}

function bool(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export function loadAppConfig(): AppConfig {
  const nodeEnv = str('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';
  const wxAppId = str('WX_APPID');
  const wxSecret = str('WX_SECRET');
  const hasWxCredentials = Boolean(wxAppId && wxSecret);

  return {
    nodeEnv,
    isProd,
    port: int('PORT', 3000),
    publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    databaseUrl: str('DATABASE_URL'),
    sessionTtlDays: int('SESSION_TTL_DAYS', 30),
    adminToken: str('ADMIN_TOKEN'),
    storage: {
      driver: str('STORAGE_DRIVER', 'local') === 's3' ? 's3' : 'local',
      localDir: str('STORAGE_LOCAL_DIR', './.data/storage'),
      urlSecret: str('STORAGE_URL_SECRET', 'blancall-dev-secret-change-me'),
      signedUrlTtlSec: int('STORAGE_SIGNED_URL_TTL_SEC', 600),
      s3: {
        endpoint: str('S3_ENDPOINT'),
        region: str('S3_REGION', 'us-east-1'),
        bucket: str('S3_BUCKET'),
        accessKeyId: str('S3_ACCESS_KEY_ID'),
        secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
        forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
      },
    },
    wx: {
      appId: wxAppId,
      secret: wxSecret,
      devLogin: bool('DEV_LOGIN', !hasWxCredentials),
    },
    wxSecurity: {
      enabled: bool('WX_SECURITY_ENABLED', hasWxCredentials),
      scene: int('WX_SECURITY_SCENE', 2),
    },
    wxSubscribe: {
      templateId: str('WX_SUBSCRIBE_TEMPLATE_ID'),
    },
    ai: {
      baseUrl: str('AI_BASE_URL').replace(/\/+$/, ''),
      apiKey: str('AI_API_KEY'),
      model: str('AI_MODEL'),
      timeoutMs: int('AI_TIMEOUT_MS', 40000),
      dailyBudgetCards: Math.max(0, int('AI_DAILY_BUDGET_CARDS', 0)),
    },
    gaokaoDir: str('GAOKAO_ASSETS_DIR'),
    exportTtlSec: int('EXPORT_TTL_SEC', 600),
    leaderboardCron: str('LEADERBOARD_CRON', '0 3 * * *'),
    timezone: str('TZ', 'Asia/Shanghai'),
  };
}


/** 便捷判断：AI 上游是否已配置 */
export function isAiConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.ai.baseUrl && cfg.ai.apiKey && cfg.ai.model);
}