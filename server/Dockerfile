# syntax=docker/dockerfile:1
# Blancall 小程序后端 · 多阶段构建
# 说明：运行阶段直接复用构建阶段的 node_modules（含 devDependencies + Prisma 生成的 client），
#       保证 `npx prisma db push` 在容器内可用；如需更小镜像，后续可单独做 prune 优化。

# ---------------- 构建阶段 ----------------
FROM node:20-alpine AS builder
WORKDIR /app

# 优先使用 npmmirror（境外环境可去掉 --registry）
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund --registry=https://registry.npmmirror.com; \
    else \
      npm install --no-audit --no-fund --registry=https://registry.npmmirror.com; \
    fi

# 生成 Prisma Client（必须在 build 之前）
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY assets ./assets
RUN npm run build

# ---------------- 运行阶段 ----------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# 时区对齐 Asia/Shanghai（签到/排行榜按中国自然日计算）
RUN apk add --no-cache dumb-init tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/assets ./assets
COPY package.json ./

# 本地对象存储目录（STORAGE_DRIVER=local 时使用，建议挂载卷）
RUN mkdir -p /data/storage
ENV STORAGE_LOCAL_DIR=/data/storage

EXPOSE 3000

# 健康检查走公开的素材库接口（不依赖数据库写入）
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/library/gaokao/index >/dev/null 2>&1 || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]