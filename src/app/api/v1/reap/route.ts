import { NextResponse } from 'next/server';
import { reapStaleRuns } from '@/lib/tracker/core';
import { TRACKER_API_KEY, RUN_TIMEOUT_MS } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/reap
 * 文档 03.1：「最终未正常结束的运行记录，应由后端超时兜底，不能无限保持 running」
 *
 * 本地手动触发：curl -X POST localhost:3100/api/v1/reap -H "x-api-key: dev-tracker-key"
 * 生产建议用 cron / Vercel Cron 每 5 分钟打一次。
 */
export async function POST(req: Request) {
  if (req.headers.get('x-api-key') !== TRACKER_API_KEY) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await reapStaleRuns(RUN_TIMEOUT_MS);
    return NextResponse.json({ ok: true, timeout_ms: RUN_TIMEOUT_MS, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'POST /api/v1/reap', timeout_ms: RUN_TIMEOUT_MS });
}
