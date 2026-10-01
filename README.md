# Blancall-miniapp

Blancall — article-to-cloze memory trainer (WeChat Mini Program + NestJS server). FSRS spaced repetition, offline-first, completely free — no paid features.

> 由 Android 端 **Blancall**（Kotlin / Compose / 纯本地存储）迁移复刻而来，功能等价。**完全免费。**

## 目录结构

```
blancall-miniapp/
├─ miniprogram/                  # 原生 TypeScript 小程序（单端，主包体积最优）
│  ├─ app.ts / app.json / app.wxss / theme.json / project.config.json
│  ├─ core/                      # 与 UI 无关的业务内核（可单测）
│  │  ├─ algorithms/             # Kotlin 算法忠实移植（分句/挖空/判定/FSRS/遮挡/热力图…）
│  │  ├─ storage/                # 本地存储（wx.setStorageSync）、实体、偏好、同步 oplog
│  │  ├─ net/                    # 请求封装、API、鉴权、云同步引擎
│  │  ├─ practice/               # 练习会话引擎（判定/评分/提示/断点）
│  │  ├─ stats/                  # 统计口径聚合
│  │  ├─ ai/ upload/ library/ theme/ store/ telemetry/ utils/
│  ├─ components/                # nav-bar / glass-switch / empty-state / lock-mask / privacy-popup
│  ├─ custom-tab-bar/            # 自定义 tabBar
│  ├─ pages/                     # 主包页面：home/list/import/practice/result/reader/overview/settings/search/library/onboarding/help
│  ├─ packages/                  # 分包：stats / account / tools / ai
│  └─ tests/                     # node:test 单元测试（算法对拍）
├─ server/                       # NestJS + Prisma + PostgreSQL 后端（可选自建方案）
└─ docs/                         # 接口规范 / 数据模型 / 前端规范 / 验收清单 / 部署说明
```

## 快速开始（小程序端）

1. 安装微信开发者工具，导入 `miniprogram/` 目录（`project.config.json` 内 `appid` 默认为 `touristappid`，替换为你自己的小程序 AppID）。
2. 修改 `miniprogram/core/net/cloud.ts` 的 `CLOUD_ENDPOINT` / `CLOUD_PUBLISHABLE_KEY` / `WX_APPID` 占位符，接入你自己的云服务。
3. 编译预览：主包功能（导入/练习/统计/阅读/素材库）可离线使用；云能力（同步/上传/AI/签到/排行）需登录并联通后端。

### 本地类型检查与单元测试

```bash
cd miniprogram
npm install
npx tsc -p tsconfig.json --noEmit     # 全量类型检查
node --test tests/                    # 算法单元测试
```

## 关键设计

| 主题 | 说明 |
|---|---|
| 数据主键 | Android 自增 id → **UUIDv7**；`contentHash` 用 MD5（`core/utils/digest.ts` 纯 TS 实现，已与 Python hashlib 对拍） |
| 数据存储 | 本地 Storage 为权威副本（小程序原生 `wx.setStorageSync`）；登录后与服务端**增量双向同步**（实体级 LWW + 墓碑） |
| 练习口径 | 分句/挖空/判定/评分/提示（10s 弱 → 5s 强）/FSRS-6 全部逐行移植，见 `core/algorithms` 与 `core/practice` |
| AI | 平台代理（用户无需自配 Key）；**AI 只返回坐标，本地按坐标切片**；失败/超时回退本地算法；**不做联网搜索** |
| 素材库 | 高考必背 60 篇文本（require 模块内置，离线可用） |
| 提醒 | 系统通知 → **订阅消息** + 服务端定时任务；站内 DUE 卡片兜底 |
| 视觉 | 液态玻璃（模糊 + 半透明 + 高光描边）；深色纯黑、浅色米白/纯白可切换、多套主题色 |

## 文档索引

| 文档 | 内容 |
|---|---|
| `docs/02-接口规范.md` | 全部接口、错误码、同步协议 |
| `docs/03-数据模型.md` | 客户端实体 + 服务端表结构 |
| `docs/04-前端实现规范.md` | 页面约定、组件、设计系统、core 模块 API |
| `docs/05-验收清单.md` | 「功能等价」验收清单 |
| `server/README.md` | 后端部署说明 |

## 质量保障（自动检查）

```bash
cd miniprogram
npm install
npm run verify          # 页面完整性 + WXML/TS 绑定一致性 + 前后端契约 + 类型检查 + 算法单测
```

## License

[MIT](LICENSE)
