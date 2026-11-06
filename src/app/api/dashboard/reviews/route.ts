import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { reviewSchema } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/dashboard/reviews
 * 人工评审：ok / bad / unsure
 *
 * 这是「坏例子率」分母的来源。没有"评审为正常"的记录，
 * 坏例子率就只能拿 Case 数除以 Case 数，永远是 100%。
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation failed', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { request_id, verdict, note, reviewer } = parsed.data;

  const exists = await query(
    `SELECT 1 FROM analytics.agent_runs WHERE request_id = $1`,
    [request_id],
  );
  if (!exists.length) {
    return NextResponse.json({ ok: false, error: 'request_id 不存在' }, { status: 404 });
  }

  await query(
    `INSERT INTO analytics.reviews (request_id, verdict, note, reviewer, reviewed_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (request_id) DO UPDATE
       SET verdict = EXCLUDED.verdict,
           note = EXCLUDED.note,
           reviewer = EXCLUDED.reviewer,
           reviewed_at = now()`,
    [request_id, verdict, note ?? null, reviewer],
  );

  return NextResponse.json({ ok: true, request_id, verdict });
}
