import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/cases/export
 * 导出 Case 集为 JSON，用于构造评测集
 */
export async function GET() {
  const rows = await query<Record<string, unknown>>(
    `SELECT c.id, c.request_id, c.title, c.category, c.severity, c.status,
            c.description, c.expected_behavior, c.owner, c.fix_version,
            c.created_by, c.created_at,
            r.model_version, r.prompt_version, r.status AS run_status,
            r.duration_ms, r.error_code, r.last_feedback
       FROM analytics.case_records c
       JOIN analytics.agent_runs r ON r.request_id = c.request_id
      ORDER BY c.created_at DESC`,
  );

  const payload = {
    exported_at: new Date().toISOString(),
    total: rows.length,
    cases: rows,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="nuanyu-cases-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}
