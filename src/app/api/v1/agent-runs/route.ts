import { NextResponse } from 'next/server';
import { agentStartSchema, agentEndSchema } from '@/lib/schema';
import { startAgentRun, endAgentRun } from '@/lib/tracker/core';
import { TRACKER_API_KEY, PII_STORAGE_ENABLED } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean {
  return req.headers.get('x-api-key') === TRACKER_API_KEY;
}

/**
 * POST /api/v1/agent-runs
 *
 * 一次调用同时承担 E03 / E04 / E05：
 *   { action: 'start',  session_id, message_id, request_id, model_version, prompt_version }
 *   { action: 'end',    request_id, status: 'success'|'error'|'timeout', duration_ms, error_code }
 *
 * 拆分理由：产品侧只需记一个 URL，接入成本最低。
 */
export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const action = (body as { action?: string })?.action;

  if (action === 'start') {
    const parsed = agentStartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'validation failed', details: parsed.error.issues },
        { status: 422 },
      );
    }
    try {
      const result = await startAgentRun({
        ...parsed.data,
        store_pii: PII_STORAGE_ENABLED,
      });
      return NextResponse.json({ ok: true, action: 'start', ...result });
    } catch (err) {
      console.error('[agent-runs] start 失败', err);
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'unknown' },
        { status: 500 },
      );
    }
  }

  if (action === 'end') {
    const parsed = agentEndSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'validation failed', details: parsed.error.issues },
        { status: 422 },
      );
    }
    try {
      const result = await endAgentRun({
        ...parsed.data,
        store_pii: PII_STORAGE_ENABLED,
      });
      return NextResponse.json({ ok: true, action: 'end', ...result });
    } catch (err) {
      console.error('[agent-runs] end 失败', err);
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'unknown' },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { ok: false, error: "action 必须是 'start' 或 'end'" },
    { status: 400 },
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'POST /api/v1/agent-runs',
    actions: {
      start: 'E03，建 running 记录',
      end: 'E04/E05，收敛为 success/error/timeout，只生效一次',
    },
  });
}
