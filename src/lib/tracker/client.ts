// 产品侧的轻量上报客户端
// 与 examples/product-integration.ts 里的 track() 相同，供直接拷贝使用

export interface TrackInput {
  event_name:
    | 'session_start'
    | 'message_send'
    | 'agent_request_start'
    | 'agent_response'
    | 'agent_error'
    | 'feedback_submit'
    | 'retry_click'
    | 'session_end';
  session_id: string;
  message_id?: string;
  request_id?: string;
  source: 'web' | 'server';
  properties?: Record<string, unknown>;
  /** 重试上报时传入原 event_id，保证幂等 */
  event_id?: string;
}

export interface TrackOptions {
  baseUrl?: string;
  apiKey?: string;
  silent?: boolean;
}

export async function track(input: TrackInput, opts: TrackOptions = {}) {
  const baseUrl = opts.baseUrl ?? process.env.ANALYTICS_URL ?? 'http://localhost:3100';
  const apiKey = opts.apiKey ?? process.env.ANALYTICS_KEY ?? 'dev-tracker-key';

  const body = {
    event_id: input.event_id ?? globalThis.crypto.randomUUID(),
    schema_version: 1,
    ...input,
  };

  try {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok && opts.silent !== false) {
      console.warn('[analytics] 上报失败', res.status, await res.text());
    }
    return await res.json().catch(() => null);
  } catch (err) {
    // 埋点失败绝不影响主流程
    if (opts.silent !== false) console.warn('[analytics] 上报异常', err);
    return null;
  }
}
