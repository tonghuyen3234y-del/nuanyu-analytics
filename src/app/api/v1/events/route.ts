import { NextResponse } from 'next/server';
import { batchPayloadSchema, eventPayloadSchema } from '@/lib/schema';
import { ingestEvent } from '@/lib/tracker/core';
import { TRACKER_API_KEY } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

function checkAuth(req: Request): boolean {
  const key = req.headers.get('x-api-key');
  return key === TRACKER_API_KEY;
}

/**
 * POST /api/v1/events
 * 接收 E01/E02/E06/E07/E08 等前端与后端行为事件。
 * 支持单条或批量：{ events: [...] } 或单个事件对象。
 */
export async function POST(req: Request) {
  if (!checkAuth(req)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const isBatch = body && typeof body === 'object' && 'events' in body;

  if (isBatch) {
    const parsed = batchPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'validation failed', details: parsed.error.issues },
        { status: 422 },
      );
    }
    const results = [];
    for (const ev of parsed.data.events) {
      try {
        results.push(await ingestEvent(ev));
      } catch (err) {
        results.push({
          event_id: ev.event_id,
          event_name: ev.event_name,
          inserted: false,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }
    const inserted = results.filter((r) => r.inserted).length;
    return NextResponse.json({
      ok: true,
      received: results.length,
      inserted,
      duplicated: results.length - inserted,
      results,
    });
  }

  const parsed = eventPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation failed', details: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const result = await ingestEvent(parsed.data);
    if (result.error) {
      return NextResponse.json({ ok: false, ...result }, { status: 422 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[events] 写入失败', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}

/** GET /api/v1/events —— 健康检查 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'POST /api/v1/events',
    accepts: '单个事件对象 或 { events: [...] }，Header: x-api-key',
  });
}
