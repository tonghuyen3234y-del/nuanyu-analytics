// ============================================================
// wrapAgent：把 AI SDK 调用自动包上 E03/E04/E05
//
// 产品侧用法：
//   const r = await wrapAgent(ctx, () => generateText({...}))
//
// 自动处理：
//   · 生成 request_id
//   · 调用前上报 agent_request_start (E03)
//   · 成功上报 agent_response (E04)，含真实 duration_ms
//   · 失败上报 agent_error (E05)，把异常映射成规范化错误码
//   · 埋点本身出错不影响主流程（全部 try/catch 吞掉）
// ============================================================

export interface WrapAgentContext {
  /** 后台地址，例：http://localhost:3100 */
  baseUrl: string;
  /** 后台的 TRACKER_API_KEY */
  apiKey: string;
  sessionId: string;
  messageId: string;
  modelVersion?: string;
  promptVersion?: string;
  /** 重试场景：传入上一次失败的 request_id */
  originalRequestId?: string;
  isAutoRetry?: boolean;
  /** 自行指定 request_id，不传则自动生成 */
  requestId?: string;
  /** 埋点失败时是否静默。默认 true */
  silent?: boolean;
}

export type CanonicalErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'UPSTREAM_ERROR'
  | 'CONTEXT_OVERFLOW'
  | 'TOOL_CALL_FAILED'
  | 'PARSE_ERROR'
  | 'AUTH_ERROR'
  | 'UNKNOWN';

/**
 * 把任意异常映射成文档 04.1 规定的规范化错误码。
 * 这个映射决定了看板上「错误码分布」是否可用，
 * 如果让异常自由命名，那张图就废了。
 */
export function toErrorCode(err: unknown): CanonicalErrorCode {
  const e = err as { name?: string; code?: string; status?: number; message?: string };
  const text = `${e?.name ?? ''} ${e?.code ?? ''} ${e?.message ?? ''}`.toLowerCase();

  if (text.includes('timeout') || text.includes('etimedout') || text.includes('aborted')) {
    return 'TIMEOUT';
  }
  if (text.includes('rate limit') || text.includes('429') || text.includes('ratelimit')) {
    return 'RATE_LIMIT';
  }
  if (
    text.includes('context length') ||
    text.includes('too many tokens') ||
    text.includes('context_length_exceeded') ||
    text.includes('maximum context')
  ) {
    return 'CONTEXT_OVERFLOW';
  }
  if (text.includes('tool') || text.includes('function call')) {
    return 'TOOL_CALL_FAILED';
  }
  if (text.includes('json') || text.includes('parse') || text.includes('syntax')) {
    return 'PARSE_ERROR';
  }
  if (
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('403') ||
    text.includes('api key') ||
    text.includes('forbidden')
  ) {
    return 'AUTH_ERROR';
  }
  if (e?.status && e.status >= 500) return 'UPSTREAM_ERROR';
  return 'UNKNOWN';
}

async function post(
  ctx: WrapAgentContext,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ctx.apiKey },
      body: JSON.stringify(body),
      // 埋点不应拖慢主流程
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok && ctx.silent !== false) {
      console.warn('[analytics] 上报失败', path, res.status);
    }
  } catch (err) {
    if (ctx.silent !== false) {
      console.warn('[analytics] 上报异常', path, (err as Error)?.message);
    }
  }
}

/**
 * 包住一次 AI 调用。
 * duration_ms 由后台用 ended_at - started_at 计算，所以这里不用手动计时。
 */
export async function wrapAgent<T>(
  ctx: WrapAgentContext,
  fn: () => Promise<T>,
  extract?: (result: T) => { output_text?: string },
): Promise<T> {
  const requestId = ctx.requestId ?? globalThis.crypto.randomUUID();

  await post(ctx, '/api/v1/agent-runs', {
    action: 'start',
    session_id: ctx.sessionId,
    message_id: ctx.messageId,
    request_id: requestId,
    model_version: ctx.modelVersion ?? null,
    prompt_version: ctx.promptVersion ?? null,
    original_request_id: ctx.originalRequestId ?? null,
    is_auto_retry: ctx.isAutoRetry ?? false,
  });

  try {
    const result = await fn();

    await post(ctx, '/api/v1/agent-runs', {
      action: 'end',
      request_id: requestId,
      status: 'success',
      model_version: ctx.modelVersion ?? null,
      prompt_version: ctx.promptVersion ?? null,
      ...(extract ? { output_text: extract(result)?.output_text ?? null } : {}),
    });

    return result;
  } catch (err) {
    const code = toErrorCode(err);

    await post(ctx, '/api/v1/agent-runs', {
      action: 'end',
      request_id: requestId,
      status: code === 'TIMEOUT' ? 'timeout' : 'error',
      error_code: code,
      error_message: (err as Error)?.message?.slice(0, 1000) ?? null,
      model_version: ctx.modelVersion ?? null,
    });

    throw err;
  }
}

/**
 * 流式场景（streamText）用这个。
 * 因为流式回答会在多个分片里回调，只有最后一次能算结束（文档 03.1）。
 */
export async function wrapAgentStream<T>(
  ctx: WrapAgentContext,
  fn: () => Promise<T & { text: Promise<string> }>,
): Promise<T> {
  return wrapAgent(ctx, async () => {
    const res = await fn();
    // 等流真正结束，耗时才是真实的
    await res.text.catch(() => {});
    return res;
  });
}
