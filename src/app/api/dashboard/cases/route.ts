import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { caseCreateSchema, caseUpdateSchema } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/dashboard/cases —— 从一条执行记录建 Case */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const parsed = caseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation failed', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const d = parsed.data;

  const exists = await query(`SELECT 1 FROM analytics.agent_runs WHERE request_id=$1`, [
    d.request_id,
  ]);
  if (!exists.length) {
    return NextResponse.json({ ok: false, error: 'request_id 不存在' }, { status: 404 });
  }

  const duplicate = await query<{ id: string }>(
    `SELECT id FROM analytics.case_records WHERE request_id=$1`,
    [d.request_id],
  );
  if (duplicate.length) {
    return NextResponse.json(
      { ok: false, error: '该执行记录已在 Case 集中', case_id: duplicate[0].id },
      { status: 409 },
    );
  }

  const rows = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO analytics.case_records
         (request_id,title,category,severity,description,expected_behavior,
          status,owner,fix_version,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        d.request_id,
        d.title,
        d.category ?? null,
        d.severity,
        d.description,
        d.expected_behavior ?? null,
        d.status,
        d.owner ?? null,
        d.fix_version ?? null,
        d.created_by,
      ],
    );

    // 同步标记为已评审·坏例子（触发器也会做，这里显式一遍更直观）
    await client.query(
      `INSERT INTO analytics.reviews (request_id, verdict, reviewer, note)
       VALUES ($1,'bad',$2,'由 Case 建立自动记录')
       ON CONFLICT (request_id) DO UPDATE SET verdict='bad', reviewer=EXCLUDED.reviewer, reviewed_at=now()`,
      [d.request_id, d.created_by],
    );

    return inserted.rows;
  });

  return NextResponse.json({ ok: true, case_id: rows[0].id });
}

/** PATCH /api/dashboard/cases —— 更新 Case */
export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const id = (body as { id?: string })?.id;
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });

  const parsed = caseUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation failed', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return NextResponse.json({ ok: true, updated: 0 });

  const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = fields.map(([, v]) => v);

  await query(`UPDATE analytics.case_records SET ${sets} WHERE id = $1`, [id, ...values]);

  return NextResponse.json({ ok: true, updated: fields.length });
}

/** DELETE /api/dashboard/cases?id=xxx */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  await query(`DELETE FROM analytics.case_records WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
