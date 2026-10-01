# 服务商验证清单（verify-checklist）

> 前提：已安装 Node.js 20 与 PostgreSQL（或使用 `docker compose up -d postgres`）。
> 本仓库交付时（开发机）已通过：`npm install` / `prisma generate` / `tsc --noEmit` / `nest build`；
> 数据库迁移、seed 与接口冒烟**需在本文件环境下执行**。

---

## 0. 一次性准备

```bash
cd server
cp .env.example .env
# 至少修改：DATABASE_URL、STORAGE_URL_SECRET、PUBLIC_BASE_URL
# 联调内容安全/AI 时再补 WX_* / AI_*
```

> Windows 下 `curl` 是 `Invoke-WebRequest` 的别名，请用 `curl.exe`，示例统一按 bash 书写。

---

## 1. 安装与构建

```bash
node -v                                   # 期望 v20.x
npm install --registry=https://registry.npmmirror.com
npx prisma generate                       # 期望：Generated Prisma Client
npx tsc --noEmit -p tsconfig.json         # 期望：无输出（退出码 0）
npm run build                             # 期望：生成 dist/main.js + dist/assets/gaokao
ls dist/assets/gaokao | wc -l             # 期望：61（p1..p60.txt + index.html）
```

## 2. 数据库迁移

```bash
# 方式 A：生产/已有库
npx prisma db push        # 依次执行 20260927000000_init 与 20260927000001_reminder_logs
npx prisma db seed

# 方式 B：本地无迁移历史，直接对齐 schema（仅开发）
npx prisma db push && npx prisma db seed

# 校验
npx prisma studio          # 或：
psql "$DATABASE_URL" -c "select nextval('entity_rev_seq');"   # 期望：返回整数，序列存在
psql "$DATABASE_URL" -c '\d reminder_sent_logs'              # 期望：表存在，(user_id,date) 唯一
```

## 3. 启动

```bash
npm run start
# 期望日志：Blancall API 已启动：http://0.0.0.0:3000/api/v1（development）
#          对象存储：local｜微信登录：DEV_LOGIN(mock)｜内容安全：未配置(securitySkipped)｜AI 上游：未配置
```

```bash
BASE=http://localhost:3000/api/v1
curl -s $BASE/library/gaokao/index | head -c 300     # 公开接口，期望 [{no,title},...] 60 项
```

---

## 4. 接口冒烟（curl 列表）

### 4.1 认证

```bash
# 登录（DEV_LOGIN）
curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -H 'X-Platform: android' \
  -d '{"code":"smoke-1","platform":"android"}'
# 期望 { ok:true, data:{ token, expiresAt, user:{id,nickname,avatar,rankVisible,createdAt}, isNew:true } }

TOKEN=<粘贴上面的 token>
AUTH="Authorization: Bearer $TOKEN"

# 幂等登录：同 code 再登一次 → 同 openid、isNew:false
curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"code":"smoke-1"}'

curl -s $BASE/me -H "$AUTH"
curl -s -X PATCH $BASE/me -H "$AUTH" -H 'Content-Type: application/json' -d '{"nickname":"测试用户"}'
curl -s -X POST $BASE/auth/refresh -H "$AUTH"
```

### 4.2 空间

```bash
curl -s $BASE/space/usage -H "$AUTH"      # 期望 { usedBytes:0, totalBytes:314572800 }
```

### 4.3 同步（push / pull）

```bash
# push 一条 article
curl -s -X POST $BASE/sync/push -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "deviceId":"dev-smoke",
  "ops":[{"entity":"article","op":"upsert","uuid":"11111111-1111-4111-8111-111111111111",
          "updatedAt":1750000000000,
          "payload":{"title":"测试文章","content":"第一句。第二句。","author":"","autoIndent":true,"createdAt":1750000000000,"updatedAt":1750000000000}}]
}'
# 期望 { ok:true, data:{ results:[{uuid,status:"applied",rev,serverUpdatedAt}], serverTime } }

# 同 uuid 用更旧 updatedAt 再推 → status:"conflict"
# 同 uuid 用更新 updatedAt 再推 → status:"applied"

# 删除（写墓碑）
curl -s -X POST $BASE/sync/push -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"ops":[{"entity":"article","op":"delete","uuid":"11111111-1111-4111-8111-111111111111","updatedAt":1760000000000}]}'

# pull（含墓碑）
curl -s "$BASE/sync/pull?cursor=0&limit=500" -H "$AUTH"
# 期望 { ok:true, data:{ items:[{entity,uuid,op,payload,rev,updatedAt}], nextCursor, hasMore:false } }

# study_stat 落表校验（用于时长榜）
curl -s -X POST $BASE/sync/push -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"ops":[{"entity":"study_stat","op":"upsert","uuid":"2026-09-27","updatedAt":1759000000000,
        "payload":{"date":"2026-09-27","practiceSeconds":600,"readingSeconds":300,"practiceCount":2}}]}'
psql "$DATABASE_URL" -c "select * from study_stats;"   # 期望 1 行，合计 900 秒
```

### 4.4 上传（文档 / 字体）

```bash
echo "第一段。第二段。" > /tmp/smoke.txt
curl -s -X POST $BASE/uploads/documents -H "$AUTH" -F "file=@/tmp/smoke.txt"
# 期望 { ok:true, data:{ id, name:"smoke.txt", ext:"txt", size, status:"uploaded", securitySkipped:true } }

DOCID=<上面的 id>
curl -s $BASE/uploads/documents -H "$AUTH"
curl -s -X POST $BASE/uploads/documents/$DOCID/parse -H "$AUTH"
# 期望 { ok:true, data:{ title:"smoke", paragraphs:["第一段。第二段。"], plainText:"第一段。第二段。", securitySkipped:true } }

# PDF 未购权益 → 应被拒
curl -s -X POST $BASE/uploads/documents -H "$AUTH" -F "file=@/path/any.pdf"
# 期望 { ok:false, code:"FORBIDDEN_FEATURE", missing:["pdf_import"] }

# 删除（释放空间）
curl -s -X DELETE $BASE/uploads/documents/$DOCID -H "$AUTH"
curl -s $BASE/space/usage -H "$AUTH"      # 期望 usedBytes 回落

# 字体（用一个真实 .ttf/.otf 测试；.ttc 应被拒）
curl -s -X POST $BASE/uploads/fonts -H "$AUTH" -F "file=@/path/font.ttf"
# 期望 { ok:true, data:{ id, family:"字体家族名", url:"...(签名URL)" } }
curl -s $BASE/fonts -H "$AUTH"
curl -s -X DELETE $BASE/fonts/<id> -H "$AUTH"
```

> 签名 URL 有效期 ≤10 分钟。原样 `curl` 该 URL 应返回文件内容；把 `sig` 改一位应返回 403。

### 4.6 签到 / 排行榜

```bash
curl -s -X POST $BASE/checkin -H "$AUTH"
# 期望 { ok:true, data:{ credits:1, streak:{current:1,longest:1} } }
# 再次调用 → { credits:0, ..., alreadyCheckedIn:true }

curl -s "$BASE/checkin/calendar?month=$(date +%Y-%m)" -H "$AUTH"
# 期望 days 覆盖整月，今天 checkedIn:true

curl -s "$BASE/leaderboard?type=credit&period=all" -H "$AUTH"
curl -s "$BASE/leaderboard?type=time&period=week" -H "$AUTH"
# 期望 { top:[{rank,nickname:"xx****",score,isMe}], me:{rank,score} }

```

### 4.7 排行榜快照定时任务

```bash
# 临时把 LEADERBOARD_CRON 改为近 1 分钟（例如 '*/1 * * * *'）后重启，观察日志：
#   [LeaderboardSnapshotService] 排行榜快照任务已注册：*/1 * * * *（时区 Asia/Shanghai）
#   随后每分钟出现「排行榜快照生成完成，共 4 组」
psql "$DATABASE_URL" -c "select type,period,period_key from leaderboard_snapshots;"
# 期望 4 行：credit/time × week/all
```

### 4.8 AI

```bash
# 未配置 AI_BASE_URL 时：
curl -s -X POST $BASE/ai/cloze -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"articleText":"子曰：学而时习之。","mode":"SENTENCE"}'
# 期望 { ok:false, code:"UPSTREAM_FAILED", message:"AI 上游未配置：请设置 AI_BASE_URL / AI_API_KEY / AI_MODEL" }
# 配置 DeepSeek 后：POST /ai/cloze → { coords:[...], aiGenerated:true }
#                  POST /ai/analysis → { markdown:"...", aiGenerated:true, cost:1 }
#                  GET  /ai/quota → balance 已扣减

# 流式对话（观察 chunked 分块）
curl -sN -X POST $BASE/ai/chat -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"帮我讲解背诵方法"}]}'
# 期望逐块输出：data: {"sessionId":"...","delta":"...","aiGenerated":true}
#           结束：data: {"sessionId":"...","done":true,"aiGenerated":true}

curl -s $BASE/ai/sessions -H "$AUTH"
curl -s $BASE/ai/sessions/<sessionId> -H "$AUTH"
curl -s -X DELETE $BASE/ai/sessions/<sessionId> -H "$AUTH"
```

### 4.9 素材库 / 导出 / 日志

```bash
curl -s $BASE/library/gaokao/index | head -c 200
curl -s $BASE/library/gaokao/1 | head -c 300           # 期望 {no:1,title:"《论语》十二章",text:"..."}

curl -s -X POST $BASE/export/csv -H "$AUTH" -H 'Content-Type: application/json' -d '{}'
# 期望 { ok:true, data:{ fileUrl, expireAt } }
curl -s -X POST $BASE/export/pdf -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"articleUuid":"11111111-1111-4111-8111-111111111111","mode":"WORD","includeAnswers":true}'
curl -s -X POST $BASE/export/backup -H "$AUTH"
# 逐一下载 fileUrl 校验：CSV 以 UTF-8 BOM 开头、PDF 可用阅读器打开且含答案页、JSON 含 entities 数组

curl -s -X POST $BASE/log/events -H 'Content-Type: application/json' \
  -d '{"events":[{"name":"smoke_test","ts":1759000000000,"props":{"a":1}}]}'
curl -s -X POST $BASE/log/error -H 'Content-Type: application/json' \
  -d '{"message":"smoke error","stack":"at x","page":"home"}'
psql "$DATABASE_URL" -c "select action,count(*) from audit_logs group by action;"
```

### 4.10 账号注销（最后执行）

```bash
curl -s -X POST $BASE/me/delete -H "$AUTH" -H 'Content-Type: application/json' -d '{"confirm":true}'
# 期望 { ok:true, data:{ deleted:true } }
curl -s $BASE/me -H "$AUTH"            # 期望 { ok:false, code:"UNAUTHORIZED" }
psql "$DATABASE_URL" -c "select count(*) from users where openid like 'dev_%';"       # 该用户已清除
psql "$DATABASE_URL" -c "select count(*) from entities;"                              # 该用户实体已级联删除
```

### 4.11 学习提醒（订阅消息，无 HTTP 接口）

```bash
# 1) 未配置模板时：应跳过并打 warn（不报错）
#    .env 留空 WX_SUBSCRIBE_TEMPLATE_ID 并重启，稍后看日志：
#    [ReminderService] 未配置 WX_SUBSCRIBE_TEMPLATE_ID，学习提醒已跳过（不影响其他功能）

# 2) 配置模板后造一条「当前小时命中」的提醒设置（把 hour 设为当前北京时间小时）
psql "$DATABASE_URL" <<'SQL'
-- 用真实 userId / openid 替换
insert into entities (id, user_id, entity, uuid, op, payload, rev, updated_at, deleted)
values (gen_random_uuid(), '<userId>', 'app_settings', 'app', 'upsert',
        jsonb_build_object(
          'reminderEnabled', true,
          'reminderHour', extract(hour from (now() at time zone 'Asia/Shanghai'))::int,
          'reminderMinute', 0,
          'reminderFrequency', 'DAILY',
          'reminderGoalMinutes', 15,
          'updatedAt', 1800000000000),
        nextval('entity_rev_seq'), now(), false)
on conflict (user_id, entity, uuid) do update set payload = excluded.payload, rev = excluded.rev, updated_at = now();
SQL

# 3) 触发一次扫描（无需等整点）——临时把 LEADERBOARD_CRON 之外的方式：
#    最简做法：把 WX_SUBSCRIBE_TEMPLATE_ID 配好，等下一个整点，观察日志
#    [ReminderService] 学习提醒已发送 userId=... kind=unfinished|weak|streak|not_started
#    [ReminderService] 学习提醒扫描完成：候选 N，发送 1，跳过 M

# 4) 幂等校验：同一自然日重复扫描不再发送
psql "$DATABASE_URL" -c "select user_id,date,result,template_id from reminder_sent_logs;"
# 期望：每个用户当天仅 1 行；result 为 ok:<msgid> 或 fail:<errcode>:<errmsg>
#       重复插入会因 (user_id,date) 唯一约束被拒（代码按 P2002 跳过）

# 5) 文案优先级验证：分别造 practice_state(status=IN_PROGRESS) / 含 mistakes 的 practice_record，
#    观察 sent 日志中的 kind 依次为 unfinished > weak > streak > not_started
```

---

## 5. 生产上线前必查项

| 项 | 期望 |
|---|---|
| `PAYMENT_DEV_MODE` | `false` |
| `WX_APPID` / `WX_SECRET` | 已配置，`/auth/login` 不再返回 `dev_` openid |
| `WX_SECURITY_ENABLED` | `true`；业务响应中不再出现 `securitySkipped: true` |
| `STORAGE_URL_SECRET` | 已改为随机长字符串（非 `please-change-*`） |
| `STORAGE_DRIVER` | 生产建议 `s3`；用 `local` 时必须挂载持久卷并定期备份 |
| `ADMIN_TOKEN` | 已设置为强随机串 |
| `PUBLIC_BASE_URL` | 已备案的 HTTPS 域名 |
| `WX_PAY_NOTIFY_URL` | 公网可达、指向 `/api/v1/pay/notify` |
| `WX_SUBSCRIBE_TEMPLATE_ID` | 已在公众平台申请并完成配置；`reminder.service.ts` 的 `data` 键名已与模板字段对齐 |
| 订阅消息模板 | 一次性订阅；客户端设置页已引导 `wx.requestSubscribeMessage` 授权 |
| Nginx | `client_max_body_size 60m`；`/ai/chat` 已关闭 `proxy_buffering` |
| 小程序后台 | request / downloadFile 合法域名已配置 |
| 备份 | PostgreSQL 定时备份 + 对象存储生命周期策略 |
| 日志 | 容器日志已接入采集；`audit_logs` 表有清理策略（建议 90 天） |