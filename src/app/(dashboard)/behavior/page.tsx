import Link from 'next/link';
import type { Metadata } from 'next';
import {
  getDataRange,
  getIdentityCoverage,
  getBehaviorOverview,
  getFeatureUsage,
  getFunnel,
  getRetention,
  getActivityTrend,
  getFeatureTrend,
  getPreviousPeriod,
  type BehaviorRange,
} from '@/lib/queries/behavior';
import { Empty } from '@/components/ui';
import DateRangePicker from '@/components/DateRangePicker';
import { BehaviorBoard } from '@/components/BehaviorBoard';
import { runHealthChecks } from '@/lib/queries/dashboard';
import { fmtPct, fmtNum as num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '用户行为分析 · 暖屿',
};

// ------------------------------------------------------------
// 日期工具：一律按 Asia/Shanghai 计算「今天」
// ------------------------------------------------------------
function todayCN(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shift(day: string, delta: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function validDate(s: string | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : s;
}

interface Insight {
  level: 'warn' | 'info' | 'ok';
  text: string;
  href?: string;
  cta?: string;
}

export default async function BehaviorPage(props: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await props.searchParams;
  const today = todayCN();
  const dataRange = await getDataRange();

  let to = validDate(sp.to) ?? today;
  let from = validDate(sp.from) ?? shift(to, -6);
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  const range: BehaviorRange = { from, to };

  const active: 'today' | '7d' | '30d' | 'custom' =
    from === to && to === today
      ? 'today'
      : from === shift(to, -6) && to === today
        ? '7d'
        : from === shift(to, -29) && to === today
          ? '30d'
          : 'custom';

  const [coverage, overview, prev, features, funnel, retention, activity, featureTrend, checks] =
    await Promise.all([
      getIdentityCoverage(range),
      getBehaviorOverview(range),
      getPreviousPeriod(range).catch(() => null),
      getFeatureUsage(range, 0),
      getFunnel(range),
      getRetention(range),
      getActivityTrend(range),
      getFeatureTrend(range),
      runHealthChecks(7),
    ]);

  const usage = features.map((f) => ({
    ...f,
    reach: overview.active > 0 ? f.users / overview.active : null,
  }));
  const hasData = coverage.total_events > 0;
  const hasIdentity = coverage.users > 0;
  const actorLabel = hasIdentity ? '用户' : '会话';

  // ---------- 洞察条：规则算出来的，不是写死的文案 ----------
  const insights: Insight[] = [];

  const unstarted = features.find((f) => f.event_name === 'retry_click');
  if (hasData && unstarted && unstarted.clicks === 0) {
    insights.push({
      level: 'warn',
      text: 'retry_click 全程 0 次，重试链路可能未接入',
      href: '/health',
      cta: '看埋点自检',
    });
  }

  const worst = funnel.slice(1).sort((a, b) => (b.drop_rate ?? 0) - (a.drop_rate ?? 0))[0];
  if (worst && (worst.drop_rate ?? 0) > 0.15) {
    insights.push({
      level: 'warn',
      text: `最大流失：「${worst.label}」${worst.dropped} 个${actorLabel}（${fmtPct(worst.drop_rate)}）`,
      href: `#funnel`,
      cta: '看明细',
    });
  }

  // 留存断层：某天次日留存明显低于区间均值
  const d1Points = retention.trend.filter((t) => t.d1 !== null);
  if (d1Points.length >= 4) {
    const avg = d1Points.reduce((a, t) => a + (t.d1 ?? 0), 0) / d1Points.length;
    const cliff = d1Points.find((t) => (t.d1 ?? 0) + 0.2 < avg);
    if (cliff && avg > 0) {
      insights.push({
        level: 'warn',
        text: `${cliff.day} 次日留存 ${fmtPct(cliff.d1)}，低于均值 ${fmtPct(avg)}`,
        href: '#retention',
        cta: '看留存矩阵',
      });
    }
  }

  const failing = checks.filter((c) => c.status !== 'pass' && ['A07', 'A05', 'A07b', '03.1'].includes(c.id));
  for (const f of failing) {
    insights.push({ level: 'warn', text: `埋点自检 ${f.id} 未通过：${f.name}`, href: '/health', cta: '查看' });
  }

  if (insights.length === 0 && hasData) {
    insights.push({ level: 'ok', text: '未发现明显异常' });
  }

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>用户行为分析</h1>
          <p style={{ color: 'var(--quiet)', fontSize: 13, margin: '4px 0 0' }}>
            用户怎么用产品、在哪一步流失
          </p>
        </div>
        <DateRangePicker
          from={from}
          to={to}
          today={today}
          active={active}
          dataFirst={dataRange.first}
          dataLast={dataRange.last}
        />
      </header>

      {/* 洞察条 */}
      {insights.length > 0 && (
        <div
          className="card"
          style={{ padding: '10px 14px', marginBottom: 14, background: '#fffdf8', borderColor: '#e8dcc4' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {insights.map((ins, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
                <span
                  style={{
                    color: ins.level === 'warn' ? '#a33b28' : ins.level === 'info' ? '#3a5578' : '#456135',
                    flexShrink: 0,
                  }}
                >
                  {ins.level === 'warn' ? '⚠' : ins.level === 'info' ? 'ⓘ' : '✓'}
                </span>
                <span style={{ color: '#5f594e', flex: 1 }}>{ins.text}</span>
                {ins.href && (
                  <Link href={ins.href} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {ins.cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 口径提示：只在会话口径时出现，用户口径不占位置 */}
      {!hasIdentity && hasData && (
        <div
          className="card"
          style={{
            padding: '8px 14px',
            marginBottom: 16,
            background: '#fdfbf6',
            borderColor: '#e8dcc4',
            fontSize: 12.5,
            color: '#6b6252',
          }}
        >
          <b style={{ color: '#8a6414' }}>会话口径</b>
          <span style={{ marginLeft: 8 }}>
            无 user_id_hash，活跃与留存按 session_id 统计（{num(coverage.sessions)} 个会话）
          </span>
        </div>
      )}

      {!hasData ? (
        <div className="card">
          <Empty text={`${from} ~ ${to} 区间内没有任何埋点事件。换个时间范围，或先让产品侧上报数据。`} />
        </div>
      ) : (
        <BehaviorBoard
          from={from}
          to={to}
          actorLabel={actorLabel}
          hasIdentity={hasIdentity}
          activeUsers={overview.active}
          overview={overview}
          prev={prev}
          features={usage}
          funnel={funnel}
          retention={retention}
          activity={activity}
          featureTrend={featureTrend}
        />
      )}
    </div>
  );
}
