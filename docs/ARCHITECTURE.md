# 暖屿 Case 集后台 · 架构说明

> 目标：独立可跑，产品开发完直接组合。
> 技术栈对齐主产品：Next.js + TypeScript + AI SDK + PostgreSQL

---

## 1. 整体结构

```
┌──────────────────────────────────────────────────────────┐
│  暖屿主产品（未来开发）                                     │
│  Next.js + TS + AI SDK + PostgreSQL                       │
│                                                            │
│   只做两件事：                                               │
│   ① 调 AI 前后，调一次 track_agent()                         │
│   ② 页面上加反馈按钮，调一次 track_feedback()                 │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTP（唯一耦合点）
                       ▼
┌──────────────────────────────────────────────────────────┐
│  暖屿 Case 后台（本项目，可独立部署）                        │
│                                                            │
│  /api/v1/events       ← 收埋点（幂等，event_id 去重）        │
│  /api/v1/agent-runs   ← AI 执行生命周期                      │
│                                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ PostgreSQL（同一定义，独立库或同库不同 schema 都行）    │  │
│  │  event_logs   agent_runs   reviews   case_records  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  后台页面：概览 / 运行列表 / 请求详情 / Case 集 / 埋点自检    │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 为什么这样拆（关键决策）

### 决策一：埋点走 HTTP，不直接连数据库

**理由**：产品未来可能和后台不再同一台机器、同一个库。
通过 HTTP，产品侧只知道一个 URL 和一个 key，别的都不用管。

**代价**：多一跳网络延迟（本地几百微秒，可忽略）。

**如果以后想直连数据库**：本项目也导出了 `lib/tracker/core.ts` 这个纯函数，
产品可以直接 import 它，往自己库里写。两条路都留好了。

### 决策二：数据库结构单独维护，不侵入产品库

本项目自带 `db/schema.sql`。如果产品已有一张同名表，加 `_analytics` 后缀即可。
推荐**独立 schema**（`analytics.event_logs`），一个库两个 schema 最省事。

### 决策三：AI SDK 对应关系明确

| 埋点事件 | AI SDK 里的挂载点 |
|---|---|
| E03 `agent_request_start` | `generateText()` / `streamText()` **调用前** |
| E04 `agent_response` | `.then()` 成功，取 `result.usage` / `result.finishReason` |
| E05 `agent_error` | `.catch()`，取 `error.name` 映射成错误码 |

提供了一个 `wrapAgent()` 包装器，产品侧**一行就能包上**，不用手动埋：

```ts
// 产品侧就这么写
import { wrapAgent } from '@/lib/tracker/wrap-agent'

const result = await wrapAgent(
  { sessionId, messageId, modelVersion: 'gpt-4o' },
  () => generateText({ model, prompt })
)
```

### 决策四：PII 安全默认开启

- 数据库层**没有**存原始聊天文本的字段（`event_logs` 里只有白名单 properties）
- 如果产品要存原文用于复盘，必须走单独的 `agent_runs.input_text` 字段，
  并且默认 `null`，需要显式开启 `ENABLE_PII_STORAGE=true` 才写入
- 文档 A10 验收直接对应这一点

---

## 3. 数据流

```
用户发消息
   │
   ├─→ [产品后端] 创建 session ──────→ E01 session_start
   │
   ├─→ [产品后端] 收到消息 ──────────→ E02 message_send
   │
   ├─→ [产品后端] 调 AI 前 ──────────→ E03 agent_request_start ──→ agent_runs 建行(status=running)
   │        │
   │        ├─ 成功 ─────────────────→ E04 agent_response ────────→ agent_runs 置 success
   │        │                                                      记 duration_ms / model_version
   │        └─ 失败/超时 ────────────→ E05 agent_error ───────────→ agent_runs 置 error/timeout
   │
   ├─→ [前端] 点 👍/👎 ──────────────→ E06 feedback_submit ──────→ agent_runs.last_feedback 更新
   │
   ├─→ [前端] 点重试 ────────────────→ E07 retry_click ──────────→ 记 original_request_id
   │
   └─→ [产品后端] 会话结束 ──────────→ E08 session_end
```

**看板数据来源**：
- `event_logs` → 会话量、消息数、反馈率
- `agent_runs` → 执行数、成功率、耗时（因为需要跨事件聚合，单表更快）

---

## 4. 幂等与一致性（对应文档 A05、E04/E05 互斥）

| 风险 | 本项目的处理 |
|---|---|
| 网络重发导致重复计数 | `event_id` 是主键，`INSERT ... ON CONFLICT DO NOTHING`。发了多少遍都只有 1 条 |
| E04/E05 都到达 | `agent_runs` 更新语句带 `WHERE status = 'running'`，第二次不生效 |
| 流式回答分片重复触发 E04 | 同上，`running` 状态只允许终结一次 |
| Agent 一直 `running` | 后台提供 `/api/v1/reap` 接口，定时把超时未终结的置为 `timeout` |
| `occurred_at` 被前端篡改 | 服务端如果发现 `occurred_at` 晚于当前时间 → 用服务端时间覆盖 |

---

## 5. 目录结构

```
暖屿_后台/
├── docs/
│   ├── ARCHITECTURE.md          ← 本文
│   └── INTEGRATION.md           ← 给产品研发的接入指南（含代码片段）
├── db/
│   ├── schema.sql               ← 建表
│   └── seed.sql                 ← 假数据（让后台一上线就有东西看）
├── src/
│   ├── app/
│   │   ├── api/v1/events/       ← E01/E02/E06/E07/E08 入口
│   │   ├── api/v1/agent-runs/   ← E03/E04/E05 入口
│   │   ├── api/v1/reap/         ← 超时兜底
│   │   └── (dashboard)/         ← 后台页面
│   ├── lib/
│   │   ├── db.ts                ← Postgres 连接
│   │   ├── schema.ts            ← 事件白名单、字段校验（zod）
│   │   ├── tracker/
│   │   │   ├── core.ts          ← 纯写入逻辑（HTTP 和直连共用）
│   │   │   └── wrap-agent.ts    ← AI SDK 包装器
│   │   └── queries/             ← 看板 SQL
│   └── components/
├── docker-compose.yml           ← 本地 Postgres
└── README.md
```

---

## 6. 三阶段交付

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 数据层 + 埋点 API + 假数据 | 本轮交付 |
| 二 | 后台四个页面 | 本轮交付 |
| 三 | 产品接入（等主产品就绪） | 提供包装器和指南，随时可接 |
