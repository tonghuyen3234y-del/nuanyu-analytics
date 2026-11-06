# 暖屿 · AI Agent 质量与用户行为分析后台

一个可独立运行的 AI 产品数据分析后台：**埋点采集 → Bad Case 复盘 → 用户行为分析**。

产品侧只需通过 HTTP 接口上报埋点，不改动本后台任何代码即可接入。

技术栈：**Next.js 15 + TypeScript + PostgreSQL**。
数据库连接串换成任意 Postgres（含 Supabase）即可，无 Vendor 锁定。

### 它解决什么问题

AI 产品的看板通常缺两样东西：

1. **可信的坏例子率** —— 很多看板用「已入 Case ÷ 已入 Case」做分母，永远是 100%，是自证式假指标。本项目把「评审为正常」也记进 `reviews` 表，分母是全部已评审请求。
2. **真实的用户留存** —— 只有 `session_id` 是算不出 DAU 和留存的。本项目在埋点层支持 `user_id_hash`，并且**明确标注当前用的是用户口径还是会话口径**，不假装会话数就是用户数。

---

## 快速开始

```bash
# 1. 起数据库（需要 Docker）
npm run db:up

# 2. 造测试数据（让后台一上线就有东西看）
npm install
npm run db:seed

# 3. 启动后台
npm run dev
```

打开 http://localhost:3100

> 数据库端口用 **5433**，避免和你本机已有 Postgres 冲突。

---

## 页面

| 路径 | 用途 |
|---|---|
| `/` | 概览：7 个核心指标 + 趋势 + 错误码分布 + 模型对比 |
| `/runs` | 运行列表：每条 AI 执行一行，可筛选状态/反馈/模型/错误码 |
| `/runs/{request_id}` | 请求详情：**复盘主界面**，事件时间线 + 一键建 Case |
| `/cases` | Case 集：分类打标、导出 JSON 作评测集 |
| `/behavior` | 用户行为分析：DAU/WAU/新增/人均时长/留存 + 功能使用 + 行为漏斗 + 趋势 |
| `/health` | 埋点自检：A01–A11，含用户标识覆盖度检查 |

---

## 用户行为分析（`/behavior`）

六块内容，全部直查 `event_logs` / `agent_runs`，没有任何模拟数据：

1. **核心概览** DAU / WAU / 新增用户 / 人均使用时长 / 次日留存
2. **功能使用** 每个事件的点击次数、使用人数、使用频率、使用占比、触达率
3. **行为漏斗** 进入产品 → 表示意图 → 发起 AI 执行 → 成功完成 → 正常结束
4. **留存** 按新增日建队列，D0–D7 热力矩阵 + 次日/7 日趋势
5. **趋势** 活跃折线、消息 vs 执行柱状、功能用量折线，悬停看具体数值
6. **时间筛选** 今日 / 近 7 天 / 近 30 天 / 自定义（URL 参数 `from`、`to`）

### 关于「用户」口径，务必先看这段

埋点原本只有 `session_id`，没有用户标识，所以**真正的 DAU 和留存算不出来**。
本页会检测数据里有没有 `user_id_hash`，并明确标注当前是哪种口径：

- **有** `user_id_hash` → 按用户去重，`DAU`、`留存` 才是真的
- **没有** → 退化为按 `session_id` 去重，页面顶部会写成「会话口径」，不假装成 DAU

产品侧要做的只有一件事，在所有事件的 `properties` 里带上用户标识：

```ts
await track({
  event_name: 'session_start',
  session_id: sessionId,
  source: 'server',
  properties: { user_id_hash: sha256(loginUserId) },   // 登录用户
  // 未登录时用 anonymous_id（32–128 位十六进制）
});
```

只接受 **32–128 位小写十六进制**（即 sha256 / md5 摘要）。
明文手机号、邮箱、openid 会被直接丢弃并在响应里返回 `rejected_properties`，
这是 A10「不落 PII」的延伸。`/health` 的 A11 项会检查覆盖情况。

### 交互

这一版不再是静态报表，每个模块都能往下问一层：

| 交互 | 效果 |
|---|---|
| 鼠标划过 / 拖动图表 | 十字准线跟手，浮层一次列出当天**所有**序列的值 |
| 键盘 ← → | 逐日移动游标，Esc 取消 |
| 点击图表某天 | 锁定该日，留存趋势、活跃趋势、功能趋势三张图同时对齐并画虚线 |
| 点击漏斗任意一步 | 右侧滑出抽屉，列出卡在这一步的具体账号、最后一条事件、事件数，每行可跳 `/runs` 复盘 |
| 点击留存矩阵任意格子 | 抽屉列出该队列该日回来的人，并显示队列人数 / 留存人数 |
| 点击功能表某行 / 占比条 | 高亮该功能 |
| 顶部洞察条 | 由规则实时算出：0 事件的埋点、最大流失点、留存断层、口径缺失，每条可点击跳转 |
| 指标卡环比 | 自动对比上一个等长周期；上期为 0 或不存在时不显示百分比，不编造 |

钻取走 `GET /api/dashboard/behavior/drill`，判定条件与图表**同源**（复用同一套 SQL 条件），
不会出现「图说 209 人、抽屉里却是另一批人」的情况。

### 口径细节

| 指标 | 算法 |
|---|---|
| 人均使用时长 | 有 `session_end` 的会话，`session_end − session_start` 的均值。没有结束事件的会话不计，避免把「页面一直开着」算成超长时长 |
| 漏斗 | 「到达过每一步」而非严格时间顺序，避免埋点乱序造成假流失 |
| 留存 | 按首次出现日建队列；D+n 超出观测窗口的那格留空（显示 `—`），**不按 0 计算** |
| 使用频率 | 次数 ÷ 使用人数 |
| 使用占比 | 次数 ÷ 区间内全部事件次数 |
| 触达率 | 使用人数 ÷ 区间活跃用户数 |

## 接入产品

看 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。核心就三处：

```ts
// 1. AI 调用包一层，E03/E04/E05 全自动
const result = await wrapAgent(
  { baseUrl, apiKey, sessionId, messageId, modelVersion: 'gpt-4o' },
  () => generateText({ model, prompt }),
);

// 2. 会话与消息
await track({ event_name: 'session_start', session_id, source: 'server' });
await track({ event_name: 'message_send', session_id, message_id, source: 'server' });

// 3. 用户反馈
await track({ event_name: 'feedback_submit', session_id, request_id, source: 'web',
               properties: { feedback_value: 'negative' } });
```

---

## API

| 接口 | 用途 |
|---|---|
| `POST /api/v1/events` | E01/E02/E06/E07/E08，支持单条或批量，`event_id` 幂等；`properties` 可带 `user_id_hash` / `anonymous_id` |
| `POST /api/v1/agent-runs` | `{action:'start'}` = E03；`{action:'end'}` = E04/E05 |
| `POST /api/v1/reap` | 超时兜底，把长时间 `running` 置为 `timeout` |
| `GET  /api/dashboard/behavior/drill` | 行为分析钻取：`kind=funnel&key=task` 或 `kind=retention&key=2026-10-30#3` |
| `POST /api/dashboard/reviews` | 人工评审 ok / bad / unsure |
| `POST /api/dashboard/cases` | 建 Case |
| `GET  /api/dashboard/cases/export` | 导出 Case 集 JSON |

鉴权：Header `x-api-key: <TRACKER_API_KEY>`（仅 `/api/v1/*`）

---

## 数据表

| 表 | 说明 |
|---|---|
| `event_logs` | 原始事件，只追加。`event_id` 主键实现去重（A05） |
| `agent_runs` | AI 执行记录，`status` 状态机保证 E04/E05 互斥 |
| `feedbacks` | 反馈历史（审计用） |
| `reviews` | **人工评审记录** ★ 坏例子率的分母来源 |
| `case_records` | Case 集 |

---

## 两个容易踩的坑（已处理）

**1. 坏例子率的分母**

「已确认坏 / 已入 Case」永远等于 100%，是自证式假指标。
本项目用 `reviews` 表记录**"评审为正常"**，分母是全部已评审请求（文档 05.1）。

**2. 默认不存聊天原文**

`event_logs.properties` 走白名单过滤，传了原文会被丢弃。
`agent_runs.input_text` 仅在 `ENABLE_PII_STORAGE=true` 时写入（文档 A10）。

---

## 环境变量

见 `.env.example`：

```bash
DATABASE_URL=postgresql://nuanyu:nuanyu_dev@localhost:5433/nuanyu_analytics
TRACKER_API_KEY=dev-tracker-key
ENABLE_PII_STORAGE=false
RUN_TIMEOUT_MS=600000
```

迁 Supabase 时只改 `DATABASE_URL`，并把 `db/schema.sql` 在 Supabase SQL Editor 执行一次。

---

## 目录

```
docs/ARCHITECTURE.md      架构决策与理由
docs/INTEGRATION.md       给产品研发的接入指南
db/schema.sql             建表（含约束、索引、触发器）
scripts/seed.mjs          测试数据生成
src/lib/tracker/          写入核心 + AI SDK 包装器 + 上报客户端
src/lib/queries/          看板 SQL
src/app/(dashboard)/      五个页面
examples/                 接入示例代码
```

---

## 开源

MIT License。欢迎 Issue 与 PR。

```bash
npm install
cp .env.example .env.local
npm run db:up && npm run db:seed && npm run dev
```

提交前请跑 `npm run typecheck`，CI 也会跑。

数据来自真实埋点表，本项目**不含任何虚构的指标计算**。种子脚本 `scripts/seed.mjs` 生成的只用于本地演示的随机数据，人名统一用 `pm-demo` / `dev-a` 这类占位值。

## 常用命令

```bash
npm run dev        # 开发
npm run build      # 构建
npm run db:up      # 起库
npm run db:down    # 停库
npm run db:reset   # 清空重建
npm run db:seed    # 重新造数据
npm run db:reap    # 手动跑超时兜底
npm run typecheck  # 类型检查
```
