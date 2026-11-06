import { NextResponse } from 'next/server';
import {
  getFunnelDropOff,
  getRetentionCohort,
  type BehaviorRange,
  type FunnelStep,
} from '@/lib/queries/behavior';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FUNNEL_KEYS: FunnelStep['key'][] = ['enter', 'session', 'core', 'success', 'task'];

/**
 * GET /api/dashboard/behavior/drill?kind=funnel&key=task&from=&to=
 * GET /api/dashboard/behavior/drill?kind=retention&key=2026-10-30#3
 *
 * 给「用户行为分析」页的钻取抽屉用。
 * 判定条件与页面图表同源（getFunnel / getRetention），不会出现数字打架。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind');
  const key = url.searchParams.get('key') ?? '';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 30) || 30, 100);

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: '缺少合法的 from / to' }, { status: 400 });
  }
  const range: BehaviorRange = { from, to };

  try {
    if (kind === 'funnel') {
      if (!FUNNEL_KEYS.includes(key as FunnelStep['key'])) {
        return NextResponse.json({ error: '未知的漏斗步骤' }, { status: 400 });
      }
      const { rows, total } = await getFunnelDropOff(range, key as FunnelStep['key'], limit);
      return NextResponse.json({ rows, total });
    }

    if (kind === 'retention') {
      // key 形如 2026-10-30#3
      const [day, offsetRaw] = key.split('#');
      const offset = Number(offsetRaw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(offset) || offset < 0 || offset > 7) {
        return NextResponse.json({ error: '未知的留存格子' }, { status: 400 });
      }
      const { rows, cohort, retained } = await getRetentionCohort(day, offset, limit);
      return NextResponse.json({ rows, total: retained, cohort, retained });
    }

    return NextResponse.json({ error: '未知的 kind' }, { status: 400 });
  } catch (err) {
    console.error('[behavior/drill]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
