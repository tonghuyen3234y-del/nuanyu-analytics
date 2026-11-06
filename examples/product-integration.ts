import { wrapAgent } from '@/lib/tracker/wrap-agent';

// ============================================================
// 这是给「暖屿主产品」看的示例文件
// 产品开发完后，按这里的方式接 3 处即可，不需要改后台任何代码。
// 本文件不会被打包，仅供参照。
// ============================================================

// ------------------------------------------------------------
// 准备：产品侧只需要两个环境变量
// ------------------------------------------------------------
// ANALYTICS_URL=https://analytics.nuanyu.app   （或本地 http://localhost:3100）
// ANALYTICS_KEY=dev-tracker-key

const ANALYTICS_URL = process.env.ANALYTICS_URL ?? 'http://localhost:3100';
const ANALYTICS_KEY = process.env.ANALYTICS_KEY ?? 'dev-tracker-key';

// ------------------------------------------------------------
// 第 1 处：AI 调用 —— 用 wrapAgent 包一层，E03/E04/E05 全自动
// ------------------------------------------------------------
// 改造前：
//   const result = await generateText({ model, prompt })
//
// 改造后：只多两行
// ------------------------------------------------------------
import { generateText } from 'ai';

export async function chat(params: {
  sessionId: string;
  messageId: string;
  prompt: string;
}) {
  const result = await wrapAgent(
    {
      baseUrl: ANALYTICS_URL,
      apiKey: ANALYTICS_KEY,
      sessionId: params.sessionId,
      messageId: params.messageId,
      modelVersion: 'gpt-4o',
      promptVersion: 'v1.2',
    },
    () => generateText({ model: 'gpt-4o' as never, prompt: params.prompt }),
  );

  return result;
}

// wrapAgent 内部做的事：
//   try {
//     await post('/api/v1/agent-runs', { action:'start', ...ctx, request_id })   // E03
//     const r = await fn()
//     await post('/api/v1/agent-runs', { action:'end', status:'success', ... }) // E04
//     return r
//   } catch (e) {
//     await post('/api/v1/agent-runs', { action:'end', status:'error', error_code }) // E05
//     throw e
//   }

// ------------------------------------------------------------
// 第 2 处：创建会话 / 收到消息 —— 后端各调一次
// ------------------------------------------------------------
export async function onSessionCreated(sessionId: string) {
  await track({
    event_name: 'session_start', // E01
    session_id: sessionId,
    source: 'server',
  });
}

export async function onMessageReceived(sessionId: string, messageId: string, length: number) {
  await track({
    event_name: 'message_send', // E02
    session_id: sessionId,
    message_id: messageId,
    source: 'server',
    properties: { message_length: length }, // 注意：不传原文
  });
}

// ------------------------------------------------------------
// 第 3 处：前端反馈与重试
// ------------------------------------------------------------
// 前端不能持有 ANALYTICS_KEY，所以走产品自己的 API 中转：
//
//   浏览器 → POST /api/feedback { requestId, value }
//          → 服务端校验用户身份
//          → 服务端调用 track({ event_name:'feedback_submit', ... })
//
// 不要在浏览器里直接调 /api/v1/events，否则 key 会泄露。
// ------------------------------------------------------------
export async function onFeedback(requestId: string, sessionId: string, value: 'positive' | 'negative') {
  await track({
    event_name: 'feedback_submit', // E06
    session_id: sessionId,
    request_id: requestId,
    source: 'web',
    properties: { feedback_value: value },
  });
}

export async function onRetryClick(sessionId: string, originalRequestId: string) {
  await track({
    event_name: 'retry_click', // E07
    session_id: sessionId,
    request_id: originalRequestId,
    source: 'web',
    properties: { original_request_id: originalRequestId },
  });
}

export async function onSessionEnd(sessionId: string, reason: 'explicit' | 'timeout') {
  await track({
    event_name: 'session_end', // E08
    session_id: sessionId,
    source: 'server',
    properties: { end_reason: reason },
  });
}

// ------------------------------------------------------------
// 通用上报函数
// ------------------------------------------------------------
interface TrackInput {
  event_name: string;
  session_id: string;
  message_id?: string;
  request_id?: string;
  source: 'web' | 'server';
  properties?: Record<string, unknown>;
}

async function track(input: TrackInput) {
  const body = {
    event_id: crypto.randomUUID(), // ★ 重发时必须复用同一个 ID 才能去重
    schema_version: 1,
    ...input,
  };

  try {
    const res = await fetch(`${ANALYTICS_URL}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANALYTICS_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn('[analytics] 上报失败', res.status, await res.text());
    return res.json();
  } catch (err) {
    // 埋点失败绝不能影响主流程
    console.warn('[analytics] 上报异常', err);
    return null;
  }
}
