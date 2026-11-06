import Link from 'next/link';
import { listSessions } from '@/lib/queries/dashboard';
import { Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SessionsPage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await props.searchParams;
  const days = Number(sp.days ?? 7);
  const rows = await listSessions(days);

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>会话</h1>
          <p style={{ color: 'var(--quiet)', fontSize: 13, margin: '4px 0 0' }}>
            按 session_id 聚合，用以区分「消息数」与「Agent 执行次数」
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 7, 14, 30].map((d) => (
            <Link
              key={d}
              href={`/sessions?days=${d}`}
              className="btn"
              style={{
                background: d === days ? '#f6f1ea' : '#fff',
                borderColor: d === days ? 'var(--clay)' : 'var(--line)',
                color: d === days ? 'var(--clay)' : 'var(--ink)',
              }}
            >
              近 {d} 天
            </Link>
          ))}
        </div>
      </header>

      <div className="card" style={{ overflow: 'auto' }}>
        {rows.length === 0 ? (
          <Empty text="暂无会话" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>开始时间</th>
                <th>Session ID</th>
                <th>消息数</th>
                <th>执行次数</th>
                <th>失败</th>
                <th>负反馈</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.session_id}>
                  <td className="mono">{s.started_at}</td>
                  <td className="mono" style={{ color: 'var(--quiet)' }}>
                    {s.session_id}
                  </td>
                  <td>{s.messages}</td>
                  <td>{s.runs}</td>
                  <td style={{ color: Number(s.failed) > 0 ? '#a33b28' : '#c9c3b6' }}>
                    {s.failed}
                  </td>
                  <td style={{ color: Number(s.negative) > 0 ? '#a33b28' : '#c9c3b6' }}>
                    {s.negative}
                  </td>
                  <td>
                    <Link href={`/runs?q=${encodeURIComponent(s.session_id)}`}>看执行 →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
