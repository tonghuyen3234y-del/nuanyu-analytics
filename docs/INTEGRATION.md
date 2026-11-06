# 暖屿 Case 集后台 · 接入指南

> 给「暖屿主产品」研发看。按这份文档接，**不需要改动后台任何代码**。

---

## 0. 一句话

产品侧只需要做三件事：**一个环境变量、一个包装函数、两个按钮**。

---

## 1. 配置

在你的 `.env.local` 里加两行：

```bash
ANALYTICS_URL=http://localhost:3100        # 后台地址
ANALYTICS_KEY=dev-tracker-key              # 后台的 TRACKER_API_KEY
```

> ⚠️ 这两个只在**服务端**使用。前端不要碰，key 会泄露。

---

## 2. 事件与代码位置的对应关系

| 文档编号 | 事件 | 在产品的哪里埋 | 谁埋 |
|---|---|---|---|
| E01 | `session_start` | 创建会话成功后 | 后端 |
| E02 | `message_send` | 服务端收下用户消息后 | 后端 |
| E03 | `agent_request_start` | `generateText` 调用**前** | 后端，**用 wrapAgent 自动** |
| E04 | `agent_response` | 调用成功返回 | 后端，**用 wrapAgent 自动** |
| E05 | `agent_error` | 调用抛异常 | 后端，**用 wrapAgent 自动** |
| E06 | `feedback_submit` | 用户点 👍/👎 | 前端 → 自己的 API 中转 → 后端上报 |
| E07 | `retry_click` | 用户点"重说一遍" | 同上 |
| E08 | `session_end` | 用户结束会话 / 超时 | 后端 |

---

## 3. 接 AI 调用（E03–E05 一次搞定）

把你现在的 AI 调用包一层：

```ts
// 改造前
const result = await generateText({ model, prompt });

// 改造后
import { wrapAgent } from '@/lib/tracker/wrap-agent';   // 从本后台拷贝这个文件
import { generateText } from 'ai';

const result = await wrapAgent(
  {
    baseUrl: process.env.ANALYTICS_URL!,
    apiKey: process.env.ANALYTICS_KEY!,
    sessionId,
    messageId,
    modelVersion: 'gpt-4o',       // ★ 必须写真实值，看板按这个分组
    promptVersion: 'v1.2',        // ★ 同上
  },
  () => generateText({ model, prompt }),
);
```

**自动完成的事**：

- 生成 `request_id`
- 调用前上报 E03（记 `started_at`）
- 成功上报 E04（`duration_ms` 由服务端算，前端改不了）
- 失败上报 E05（异常自动映射成 8 种规范错误码之一）
- 埋点自己出错**不会影响** AI 调用（全部吞掉）

**流式（`streamText`）** 用 `wrapAgentStream`，它会等流真正结束才算耗时。

---

## 4. 接会话与消息（E01 / E02）

```ts
import { track } from '@/lib/tracker/client';

// 会话创建成功后，只调一次
await track({
  event_name: 'session_start',
  session_id: sessionId,
  source: 'server',
});

// 服务端接受消息后
await track({
  event_name: 'message_send',
  session_id: sessionId,
  message_id: messageId,
  source: 'server',
  properties: { message_length: text.length },   // ★ 只传长度，不传原文
});
```

> **注意**：`event_id` 由 `track()` 内部生成 UUID。
> 如果失败要重试上报，**必须复用同一个 `event_id`**，否则会重复计数（文档 A05）。

---

## 5. 接前端反馈（E06 / E07）

前端**不能**直接调后台，必须经过你自己的 API：

```
浏览器                    你的 Next.js API                暖屿后台
  │                            │                              │
  │ POST /api/feedback         │                              │
  │ { requestId, value }  ───▶ │ 校验登录用户                  │
  │                            │ POST /api/v1/events  ──────▶ │ 去重入库
  │                            │                              │ 更新 last_feedback
  ◀── ok ───────────────────── │                              │
```

你的 `/api/feedback` 大概长这样：

```ts
// app/api/feedback/route.ts
export async function POST(req: Request) {
  const { requestId, value } = await req.json();
  const user = await getCurrentUser();          // ← 你自己的鉴权
  if (!user) return new Response('unauthorized', { status: 401 });

  await track({
    event_name: 'feedback_submit',
    session_id: user.sessionId,
    request_id: requestId,                      // ★ 必须指向那条 AI 回答
    source: 'web',
    properties: { feedback_value: value },      // 'positive' | 'negative'
  });

  return Response.json({ ok: true });
}
```

**关键前提**：前端必须能拿到当前这条回答的 `request_id`。
建议让 AI 接口在返回时把 `request_id` 一起给前端：

```ts
return Response.json({
  text: result.text,
  requestId,        // ← 前端存下来，点踩时带回来
});
```

---

## 6. 字段白名单（防 PII，对应 A10）

后台对 `properties` 只接受白名单内的键，其余会被**直接丢弃**并在响应里告知：

```json
{ "ok": true, "inserted": true, "rejected_properties": ["raw_text"] }
```

允许的键：

| 事件 | 允许的 properties 键 |
|---|---|
| session_start | `end_reason`, `client_platform` |
| message_send | `message_length`, `has_attachment` |
| agent_request_start | `prompt_version`, `original_request_id`, `is_auto_retry` |
| agent_response | `duration_ms`, `model_version`, `prompt_version`, `token_input`, `token_output` |
| agent_error | `error_code`, `error_message`, `duration_ms`, `model_version` |
| feedback_submit | `feedback_value`, `reason_tags` |
| retry_click | `original_request_id` |
| session_end | `end_reason` |

### 所有事件通用的两个键

这两个键在任何事件里都允许出现，用于「用户行为分析」页做用户级去重：

| 键 | 说明 |
|---|---|
| `user_id_hash` | 登录用户 id 的 sha256（或 md5）。**只收 32–128 位小写十六进制** |
| `anonymous_id` | 未登录用户的设备级随机 id，同样要求 32–128 位小写十六进制 |

```ts
import { createHash } from 'node:crypto';

const properties = {
  user_id_hash: createHash('sha256').update(String(user.id)).digest('hex'),
};
```

不传这两个键，`/behavior` 只能按 `session_id` 统计，DAU 与留存会失真，
页面顶部会显示「当前为会话口径」。`/health` 的 A11 项会提示覆盖情况。
明文手机号 / 邮箱 / openid 会被直接丢弃，并在响应里返回 `rejected_properties`。

想加字段？改 `src/lib/schema.ts` 里的 `EVENT_PROPERTY_WHITELIST`，然后重启后台。

---

## 7. 错误码（决定看板能不能用）

异常会被自动映射成这 8 个之一：

| 错误码 | 含义 |
|---|---|
| `TIMEOUT` | 超时、被中断 |
| `RATE_LIMIT` | 限流、429 |
| `CONTEXT_OVERFLOW` | 上下文超长 |
| `TOOL_CALL_FAILED` | 工具/函数调用失败 |
| `PARSE_ERROR` | 输出解析失败 |
| `AUTH_ERROR` | 401/403/key 失效 |
| `UPSTREAM_ERROR` | 上游 5xx |
| `UNKNOWN` | 其他 |

**不要让异常自由命名**——错误码一旦发散，看板上的"错误码分布"就没用了。

---

## 8. 自测清单

接完后，按顺序做一遍：

```bash
KEY=dev-tracker-key
URL=http://localhost:3100

# 1. 建一条执行
curl -s -X POST $URL/api/v1/agent-runs -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{
  "action":"start","session_id":"s-self","message_id":"m-self",
  "request_id":"r-self-1","model_version":"gpt-4o","prompt_version":"v1.2"}'

# 2. 结束它
curl -s -X POST $URL/api/v1/agent-runs -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{
  "action":"end","request_id":"r-self-1","status":"success","duration_ms":1500}'

# 3. 打反馈
curl -s -X POST $URL/api/v1/events -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{
  "event_id":"'$(uuidgen | tr A-Z a-z)'","event_name":"feedback_submit",
  "session_id":"s-self","request_id":"r-self-1","source":"web",
  "properties":{"feedback_value":"negative"}}'

# 4. 去后台确认
open $URL/runs
```

然后打开 `/health` 页，所有自检项应为绿色。

---

## 9. 如果以后想跳过 HTTP 直连数据库

后台已经把写入逻辑抽成了纯函数，在 `src/lib/tracker/core.ts`：

```ts
import { ingestEvent, startAgentRun, endAgentRun } from '@/lib/tracker/core';
```

产品可以直接 import 这些函数写自己库里的 `analytics` schema，不用起 HTTP。
表结构在 `db/schema.sql`，复制到产品库执行即可。

**但建议先用 HTTP**：未来后台独立部署、独立扩容时不用再改产品代码。
