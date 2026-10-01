# Blancall 小程序后端（server）

NestJS 10 + TypeScript(strict) + Prisma 5 + PostgreSQL 后端。**完全免费**：不包含任何计费能力。

- 接口以 `../docs/02-接口规范.md` 为参考，Base URL：`https://<api-host>/api/v1`
- 数据模型以 `../docs/03-数据模型.md` 为参考
- 统一响应：成功 `{ ok: true, data }`；失败 `{ ok: false, code, message, ...details }`

---

## 1. 技术栈与目录

| 层 | 选型 |
|---|---|
| 运行时 | Node.js 20（`engines: >=20 <21`） |
| 框架 | NestJS 10（默认 Express 适配器） |
| 语言 | TypeScript 5.4（`strict: true`） |
| ORM | Prisma 5.22（provider `postgresql`） |
| 校验 | zod（全项目统一） |
| 上传 | multer（via `@nestjs/platform-express` 的 `FileInterceptor`） |
| 定时任务 | `@nestjs/schedule` + `cron` |
| 对象存储 | 自研 `StorageService` 抽象：`local`（默认） / `s3` |
| 文档解析 | `pdf-parse`（PDF）、`mammoth`（DOCX）、自研 ZIP 读取（EPUB）、OLE2 启发式（DOC）、正则（HTML/RTF） |
| PDF 生成 | `pdfkit`（内置 CJK 字体 STSong-Light） |
| 微信 | `code2session` / `msgSecCheck` 基于 `node:crypto` + 内置 `fetch`，**不依赖第三方 SDK**；订阅消息复用同一 `access_token` 缓存服务 |

```
server/
├─ prisma/
│  ├─ schema.prisma                 # 14 张表
│  ├─ migrations/                   # 初始迁移（新库建议 migrate dev 重新生成与当前 schema 一致的迁移）
│  └─ seed.ts                       # 无需预置数据
├─ assets/gaokao/                   # 素材库语料（部署侧副本）
├─ scripts/verify-checklist.md      # 验证命令清单（含 curl 示例）
├─ src/
│  ├─ main.ts / app.module.ts
│  ├─ config/       # 强类型 env 配置
│  ├─ prisma/       # PrismaService（全局）
│  ├─ common/       # 响应/异常/错误码/日志/平台中间件/守卫/zod/时区/features
│  ├─ storage/      # StorageService（local / s3）+ 签名下载路由
│  ├─ wechat/       # 登录、内容安全、订阅消息
│  ├─ auth/         # /auth/*、/me、/me/delete
│  ├─ sync/         # /sync/push、/sync/pull
│  ├─ uploads/      # /uploads/documents、/uploads/fonts、/uploads/avatar、/fonts
│  ├─ space/        # /space/usage（统一免费额度）
│  ├─ checkin/      # /checkin、/checkin/calendar
│  ├─ leaderboard/  # /leaderboard + 每日快照定时任务
│  ├─ ai/           # /ai/cloze|analysis|chat|sessions（免费，仅平台级日预算熔断）
│  ├─ library/      # /library/gaokao/*
│  ├─ export/       # /export/csv|pdf|backup
│  ├─ log/          # /log/events、/log/error
│  └─ reminder/     # 学习提醒（服务端订阅消息，无 HTTP 接口）
├─ Dockerfile / docker-compose.yml / nginx.conf
└─ .env.example
```

---

## 2. 本地启动

```bash
# 0) Node 20
node -v            # 期望 v20.x

# 1) 依赖
npm install

# 2) 环境变量
cp .env.example .env

# 3) 生成 Prisma Client
npx prisma generate

# 4) 建库（需要一个可用的 PostgreSQL；按 schema 直接建表）
npx prisma db push

# 5) 构建与启动
npm run build
npm run start             # 或开发模式：npm run dev

# 6) 冒烟
curl http://localhost:3000/api/v1/library/gaokao/index
```

### 快速本地联调（无 PostgreSQL 时）

`docker compose up -d postgres` 起一个本地库最省事；或使用任意云数据库连接串填入 `DATABASE_URL`。

### 开发态默认行为（无需任何外部配置即可跑通）

| 能力 | 未配置时的行为 |
|---|---|
| 微信登录 | `WX_APPID` 为空 → **DEV_LOGIN**：`/auth/login` 用 `code` 生成稳定 mock openid（`dev_<sha1(code)>`） |
| 内容安全 | 未配置 → 直接放行，接口响应带 `securitySkipped: true`（生产必须配置，见 §5） |
| AI 上游 | 未配置 → `/ai/*` 返回 `UPSTREAM_FAILED`（提示设置 `AI_BASE_URL/AI_API_KEY/AI_MODEL`） |
| 对象存储 | `STORAGE_DRIVER=local`（默认）→ 落盘到 `STORAGE_LOCAL_DIR`，下载走本服务的签名 URL |

> 平台识别：请求头 `X-Platform: android | ios | devtools`（缺失或非法值按 `devtools` 处理）。

---

## 3. 环境变量表

完整注释见 `.env.example`。关键项：

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `NODE_ENV` | 否 | `development` | `production` 时启动会校验 DEV 模式与内容安全开关并告警 |
| `PORT` | 否 | `3000` | 监听端口 |
| `PUBLIC_BASE_URL` | 生产必填 | `http://localhost:3000` | 对外地址；用于拼接本地存储签名 URL |
| `DATABASE_URL` | 是 | — | PostgreSQL 连接串 |
| `SESSION_TTL_DAYS` | 否 | `30` | 会话有效期（天） |
| `ADMIN_TOKEN` | 否 | 空 | 运维接口令牌 |
| `STORAGE_DRIVER` | 否 | `local` | `local` \| `s3` |
| `STORAGE_LOCAL_DIR` | 否 | `./.data/storage` | local 落盘目录 |
| `STORAGE_URL_SECRET` | 生产必填 | 弱默认值 | local 签名 URL 的 HMAC 密钥 |
| `STORAGE_SIGNED_URL_TTL_SEC` | 否 | `600` | 签名有效期 |
| `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` | s3 时必填 | — | S3 兼容（COS/OSS/MinIO） |
| `WX_APPID` / `WX_SECRET` | 生产必填 | 空 | 小程序凭证；为空即 DEV_LOGIN |
| `DEV_LOGIN` | 否 | 自动 | 强制开发登录 |
| `WX_SECURITY_ENABLED` | 生产必填 | 自动 | 是否启用 `msgSecCheck` |
| `WX_SECURITY_SCENE` | 否 | `2` | 送检场景值 |
| `WX_SUBSCRIBE_TEMPLATE_ID` | 提醒功能必填 | 空 | 学习提醒订阅消息模板 ID。**留空则提醒任务跳过并打 warn 日志，不影响其他功能** |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 生产必填 | 空 | OpenAI 兼容上游，示例：`https://api.deepseek.com/v1` + `deepseek-chat` |
| `AI_TIMEOUT_MS` | 否 | `40000` | 上游超时 |
| `AI_DAILY_BUDGET_CARDS` | 否 | `0` | 平台级日预算熔断（成本控制，非收费）：每日全平台 AI 用量上限；`0`/留空 = 不限制 |
| `GAOKAO_ASSETS_DIR` | 否 | 自动探测 | 素材库正文目录 |
| `EXPORT_TTL_SEC` | 否 | `600` | 导出文件签名有效期 |
| `LEADERBOARD_CRON` / `TZ` | 否 | `0 3 * * *` / `Asia/Shanghai` | 快照定时任务 |

---

## 4. 数据库

```bash
npx prisma db push            # 按 schema 直接建表（本地与生产均适用）
npx prisma studio             # 可视化
```

### 关键说明

- **表清单（14 张）**：`users / sessions / entities / sync_cursors / checkins / credit_ledger / leaderboard_snapshots / study_stats / uploads / ai_sessions / ai_messages / ai_daily_usage / audit_logs / reminder_sent_logs`。
- 全部用户级外键均 `ON DELETE CASCADE`，因此 `/me/delete` 只需删除 `users` 行即可物理清除该用户全部云端数据（代码中会先删除对象存储里的文件）。
- `ai_daily_usage` 为**平台级**计数表（无用户外键），用于 AI 日预算熔断，账号注销时不受影响。
- 时区：所有「自然日」按 **Asia/Shanghai（UTC+8，无夏令时）** 计算（`src/common/time.util.ts`）。

---

## 5. 生产部署

### 5.1 域名 / 证书 / 备案

1. 域名需为**已备案**的 HTTPS 域名（微信要求 request/downloadFile 合法域名）。
2. 微信公众平台 →「开发管理 → 服务器域名」需配置：
   - `request` 合法域名：`https://api.example.com`
   - `downloadFile` 合法域名：`https://api.example.com`（字体、导出文件下载）
   - 若使用 `s3` 驱动的预签名直链（COS/OSS 域名），需把该域名也加入 `downloadFile` 白名单。
3. 证书放到 `server/certs/fullchain.pem` 与 `privkey.pem`（`docker-compose.yml` 已挂载），`nginx.conf` 中替换 `server_name`。

### 5.2 内容安全（必须）

1. 设置 `WX_APPID` / `WX_SECRET`，并设置 `WX_SECURITY_ENABLED=true`。
2. 未启用时所有文本送检会跳过并在响应中标注 `securitySkipped: true`——**上线审核会因此被拒**。
3. 覆盖范围：文档上传（解析出的正文送检）、AI 挖空/分析的输入与输出、AI 对话的输入与最终输出；字体做二进制魔数校验。
4. 送检文本统一截断为 2500 字（微信单次上限）。

### 5.3 对象存储

- **local**（默认，单机可用）：文件落盘 `STORAGE_LOCAL_DIR`，下载走 `/api/v1/files/raw` 的 HMAC 签名 URL（≤10 分钟）。生产**必须**更换 `STORAGE_URL_SECRET`，并把该目录挂载到持久卷。
- **s3**（推荐生产）：`STORAGE_DRIVER=s3` + `S3_*` 配置。腾讯云 COS/阿里云 OSS/MinIO 均兼容。

### 5.4 订阅消息（学习提醒）配置

1. 微信公众平台 →「功能 → 订阅消息」申请**一次性订阅**模板，建议字段：`thing1`（提醒内容）、`number2`（数值）、`date3`（日期）、`thing4`（来源）。
2. 把模板 ID 写入 `WX_SUBSCRIBE_TEMPLATE_ID`。
3. **模板字段必须与代码对齐**：如字段名/类型不同，请修改 `src/reminder/reminder.service.ts` 中 `sendSubscribeMessage({ data: {...} })` 的键名。
4. 授权次数由**客户端囤积**：用户授权一次 `wx.requestSubscribeMessage`，服务端才有一条发送额度。
5. 未配置模板 ID 时：提醒定时任务直接跳过并输出 warn 日志，不会报错。

### 5.5 部署步骤（Docker Compose）

```bash
cd server
cp .env.example .env
# 编辑 .env：DATABASE_URL / POSTGRES_PASSWORD / STORAGE_URL_SECRET / PUBLIC_BASE_URL / WX_* / AI_* 等
mkdir -p certs && cp <证书> certs/fullchain.pem && cp <私钥> certs/privkey.pem
docker compose up -d --build
docker compose logs -f api        # 容器启动时会自动执行 db push 建表
```

---

## 6. 定时任务

| 任务 | 触发 | 说明 |
|---|---|---|
| 排行榜快照 | `LEADERBOARD_CRON`（默认 `0 3 * * *`） | 生成 `credit/time × week/all` 共 4 组快照（`ON CONFLICT` 幂等覆盖） |
| 学习提醒 | 每小时整点 | 扫描提醒设置，命中后发送订阅消息并写 `reminder_sent_logs`（同一用户同一自然日仅一次） |

- 提醒文案优先级：**未完成练习 > 薄弱内容 > 连续学习 > 今日未学**。
- 签到、同步等均为请求内实时处理，不依赖定时任务。

---

## 7. 接口总览

共 34 条路由：

| 分组 | 路由 |
|---|---|
| 认证 | `POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout`、`GET /me`、`PATCH /me`、`POST /me/delete` |
| 同步 | `POST /sync/push`、`GET /sync/pull` |
| 上传 | `POST /uploads/documents`、`GET /uploads/documents`、`DELETE /uploads/documents/:id`、`POST /uploads/documents/:id/parse`、`POST /uploads/fonts`、`GET /fonts`、`DELETE /fonts/:id`、`POST /uploads/avatar` |
| 空间 | `GET /space/usage` |
| AI | `POST /ai/cloze`、`POST /ai/analysis`、`POST /ai/chat`、`GET /ai/sessions`、`GET /ai/sessions/:id`、`DELETE /ai/sessions/:id` |
| 签到/榜 | `POST /checkin`、`GET /checkin/calendar`、`GET /leaderboard` |
| 素材/导出/日志 | `GET /library/gaokao/index`、`GET /library/gaokao/:no`、`POST /export/csv`、`POST /export/pdf`、`POST /export/backup`、`POST /log/events`、`POST /log/error` |
| 内部 | `GET /files/raw`（local 驱动的签名下载） |

### AI 对话分块响应格式

`POST /ai/chat` 返回 `Content-Type: text/event-stream` + `Transfer-Encoding: chunked`，分块内容：

```
data: {"sessionId":"<uuid>","delta":"增量文本","aiGenerated":true}

data: {"sessionId":"<uuid>","done":true,"aiGenerated":true}

```

小程序端用 `wx.request` 的 `enableChunked` + `onChunkReceived` 解析，按 `\n\n` 切分、`data: ` 后取 JSON。

---

## 8. 安全与合规要点

- 鉴权：全局 `AuthGuard` 校验 `Authorization: Bearer <sessionToken>`；`@Public()` 仅用于登录、素材库、日志、签名下载。
- 全局 `AdminGuard`：`@AdminOnly()` 标注的运维接口需 `X-Admin-Token`。
- 越权隔离：所有上传/会话查询均带 `userId` 条件，个人资源仅本人可见。
- 数据可携：`POST /export/backup` 导出个人全部实体、签到、AI 会话。
- 账号注销：`POST /me/delete`（`{confirm:true}`）→ 删除对象存储文件 + `users` 行（级联清除全部云端数据）。
- 订阅消息：仅按用户自填的提醒设置发送；失败结果入库便于排查；不采集设备指纹与位置。

---

## 9. 常见问题

**Q1：启动报 `P1001: Can't reach database server`**
数据库不可达。检查 `DATABASE_URL`、PostgreSQL 是否启动、容器网络是否为 `postgres:5432`。

**Q2：`/auth/login` 返回的 openid 是 `dev_xxx`**
未配置 `WX_APPID`/`WX_SECRET`，处于 DEV_LOGIN。生产必须配置真实凭证。

**Q3：响应里出现 `securitySkipped: true`**
内容安全未配置。生产必须设置 `WX_SECRET` + `WX_SECURITY_ENABLED=true`。

**Q4：AI 接口报 `UPSTREAM_FAILED` 且提示未配置**
设置 `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`（示例：DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat`）。

**Q5：`prisma migrate dev` 提示要删除 `entity_rev_seq`**
该序列由初始迁移创建、不属于 Prisma schema（有意为之）。请**保留**。

**Q6：上传大文件返回 413**
multer 限制：文档 50MB、字体 20MB。经 Nginx 时确认 `client_max_body_size 60m`（`nginx.conf` 已配置）。

**Q7：AI 对话在小程序端收不到增量**
需满足：① 小程序基础库支持 `enableChunked`；② Nginx 关闭缓冲（`nginx.conf` 已对 `/api/v1/ai/chat` 设 `proxy_buffering off`）；③ 不要在服务端加压缩中间件。

**Q8：字体在 `wx.loadFontFace` 加载失败**
`downloadFile` 域名白名单需包含下载域名；本地存储模式响应已设置正确的 `font/ttf|font/otf` MIME。
