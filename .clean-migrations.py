# -*- coding: utf-8 -*-
"""彻底消除历史痕迹：删 migrations（含付费表 DDL）+ 全部 migrate deploy 引用改 db push"""
import io, os, shutil

B = r"D:\Blancall\blancall-miniapp-opensource"

# 1. 删 migrations 目录
shutil.rmtree(os.path.join(B, "server", "prisma", "migrations"))
print("1. migrations/ removed")

# 2. docker-compose 启动命令
f = os.path.join(B, "server", "docker-compose.yml")
s = io.open(f, encoding="utf-8").read()
s = s.replace('command: sh -c "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"',
              'command: sh -c "npx prisma db push --skip-generate && node dist/main.js"')
io.open(f, "w", encoding="utf-8", newline="").write(s)
print("2. docker-compose done")

# 3. Dockerfile 注释
f = os.path.join(B, "server", "Dockerfile")
s = io.open(f, encoding="utf-8").read()
s = s.replace("npx prisma migrate deploy", "npx prisma db push")
io.open(f, "w", encoding="utf-8", newline="").write(s)
print("3. Dockerfile done")

# 4. package.json scripts
f = os.path.join(B, "server", "package.json")
s = io.open(f, encoding="utf-8").read()
s = s.replace('"prisma:migrate": "prisma migrate deploy",', '"prisma:push": "prisma db push",')
io.open(f, "w", encoding="utf-8", newline="").write(s)
print("4. package.json done")

# 5. server/README.md
f = os.path.join(B, "server", "README.md")
s = io.open(f, encoding="utf-8").read()
s = s.replace("""# 4) 建库（需要一个可用的 PostgreSQL）
npx prisma migrate deploy""",
"""# 4) 建库（需要一个可用的 PostgreSQL；按 schema 直接建表）
npx prisma db push""")
s = s.replace("""```bash
npx prisma migrate deploy     # 生产
npx prisma migrate dev        # 本地开发
npx prisma studio             # 可视化
```""",
"""```bash
npx prisma db push            # 按 schema 直接建表（本地与生产均适用）
npx prisma studio             # 可视化
```""")
s = s.replace("- **`entity_rev_seq`**：`entities.rev` 的全局单调递增来源，由初始迁移用 `CREATE SEQUENCE` 创建，**不属于 Prisma schema**（有意为之）。执行 `prisma migrate dev` 时若提示删除该序列，请选择保留。\n", "")
s = s.replace("- **注意**：`prisma/migrations` 中的初始迁移基于完整版数据模型。新库建议用 `prisma migrate dev` 重新生成与当前 schema 一致的迁移。\n", "")
s = s.replace("docker compose logs -f api        # 容器启动时会自动执行 migrate deploy",
              "docker compose logs -f api        # 容器启动时会自动执行 db push 建表")
s = s.replace("| 迁移 | 升级时执行 `npx prisma migrate deploy` 后重建镜像；`entity_rev_seq` 序列**不要删除** |", "")
wr(f, s)
print("5. server/README done")

# 6. docs/01
f = os.path.join(B, "docs", "01-部署说明.md")
s = io.open(f, encoding="utf-8").read()
s = s.replace("docker compose logs -f api     # 期望：migrate deploy + db seed + 「Blancall API 已启动」",
              "docker compose logs -f api     # 期望：db push 建表 + 「Blancall API 已启动」")
s = s.replace("npm install && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && npm run build && npm run start",
              "npm install && npx prisma generate && npx prisma db push && npm run build && npm run start")
s = s.replace("`entity_rev_seq` 序列**不要删除**", "")
wr(f, s)
print("6. docs/01 done")

# 7. docs/00
f = os.path.join(B, "docs", "00-交付总览与上线清单.md")
s = io.open(f, encoding="utf-8").read()
s = s.replace("npx prisma migrate deploy", "npx prisma db push")
wr(f, s)
print("7. docs/00 done")

# 8. server/scripts/verify-checklist.md
f = os.path.join(B, "server", "scripts", "verify-checklist.md")
s = io.open(f, encoding="utf-8").read()
s = s.replace("npx prisma migrate deploy", "npx prisma db push")
io.open(f, "w", encoding="utf-8", newline="").write(s)
print("8. verify-checklist done")
