import Link from 'next/link';
import {
  getOverview,
  getTrend,
  getErrorBreakdown,
  getModelStats,
} from '@/lib/queries/dashboard';
import {
  Metric,
  BarChart,
  StatusTag,
  Empty,
  SeverityTag,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

function pct(v: number | null) {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}
function ms(v: number | null) {
  return v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

export default async function OverviewPage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await props.searchParams;
  const days = Number(sp.days ?? 7);

  const [m, trend, errors, models] = await Promise.all([
    getOverview(days),
    getTrend(days),
    getErrorBreakdown(days),
    getModelStats(days),
  ]);

  const errorPeak = Math.max(1, ...errors.map((e) => Number(e.count)));

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>概览</h1>
          <p style={{ color: 'var(--quiet)', fontSize: 13, margin: '4px 0 0' }}>
            指标口径见《埋点需求文档》05.1
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 7, 14, 30].map((d) => (
            <Link
              key={d}
              href={`/?days=${d}`}
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

      {/* 第一排：业务量 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Metric label="会话量" value={m.sessions} hint="E01 去重 session_id" />
        <Metric label="有效消息数" value={m.messages} hint="E02 去重 message_id" />
        <Metric label="Agent 执行数" value={m.runs} hint="agent_runs 的 request_id 数" />
        <Metric
          label="AI 技术成功率"
          value={pct(m.success_rate)}
          hint={`${m.success_runs} / ${m.ended_runs} 已结束执行`}
          tone={
            m.success_rate === null
              ? 'plain'
              : m.success_rate >= 0.95
                ? 'good'
                : m.success_rate >= 0.9
                  ? 'warn'
                  : 'bad'
          }
        />
        <Metric
          label="平均响应耗时"
          value={ms(m.avg_duration_ms)}
          hint={`P95 ${ms(m.p95_duration_ms)}，仅统计成功执行`}
        />
      </div>

      {/* 第二排：质量 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Metric
          label="用户负反馈率"
          value={pct(m.negative_rate)}
          hint={`${m.negative_feedback} 条负向 / ${m.feedback_total} 条有反馈`}
          tone={
            m.negative_rate === null ? 'plain' : m.negative_rate > 0.3 ? 'bad' : 'plain'
          }
        />
        <Metric
          label="已确认 Bad Case"
          value={m.confirmed_bad}
          hint="按 Case ID 去重，统计期内新建"
        />
        <Metric
          label="坏例子率"
          value={pct(m.bad_case_rate)}
          hint={
            m.reviewed > 0
              ? `${m.confirmed_bad} 入 Case ÷ ${m.reviewed} 已评审`
              : '尚无评审记录，无法计算'
          }
          tone={m.bad_case_rate === null ? 'plain' : m.bad_case_rate > 0.3 ? 'bad' : 'good'}
        />
        <Metric
          label="待处理 Case"
          value={m.cases_open}
          hint="全部时间范围内 open + fixing"
          tone={m.cases_open > 0 ? 'warn' : 'good'}
        />
        {m.running_stale > 0 && (
          <Metric
            label="异常挂起"
            value={m.running_stale}
            hint="仍为 running，需 reap 兜底"
            tone="bad"
          />
        )}
      </div>

      {/* 口径提醒 */}
      <div
        className="card"
        style={{
          padding: '11px 14px',
          marginBottom: 20,
          background: '#fdfbf6',
          borderColor: '#e8dcc4',
          fontSize: 12.5,
          color: '#6b6252',
          lineHeight: 1.7,
        }}
      >
        <b style={{ color: '#8a6414' }}>口径说明</b>
        　「坏例子率」的分母是<b>全部已评审请求</b>（{m.reviewed} 条），
        不是已入 Case 集的数量。若用后者作分母会得到恒为 100% 的假指标。
        技术成功率只代表接口是否正常返回，不代表回答质量。
      </div>

      {/* 趋势 */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>每日执行量</h2>
          <p style={{ fontSize: 12, color: 'var(--quiet)', margin: '0 0 8px' }}>
            近 {days} 天，E03–E05 汇总
          </p>
          <BarChart
            data={trend.map((t) => ({
              label: t.day,
              value: t.runs,
              sub: `成功 ${t.success} / 报错 ${t.errors} / 超时 ${t.timeouts}`,
            }))}
            height={150}
          />
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid #f0ece4',
              fontSize: 12,
              color: 'var(--quiet)',
            }}
          >
            <span>
              成功 <b style={{ color: '#456135' }}>{trend.reduce((a, t) => a + t.success, 0)}</b>
            </span>
            <span>
              报错 <b style={{ color: '#a33b28' }}>{trend.reduce((a, t) => a + t.errors, 0)}</b>
            </span>
            <span>
              超时{' '}
              <b style={{ color: '#8a6414' }}>{trend.reduce((a, t) => a + t.timeouts, 0)}</b>
            </span>
            <span>
              负反馈{' '}
              <b style={{ color: '#a33b28' }}>{trend.reduce((a, t) => a + t.negative, 0)}</b>
            </span>
          </div>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>
            错误码分布
          </h2>
          {errors.length === 0 ? (
            <Empty text="没有失败记录" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {errors.map((e) => (
                <div key={e.error_code}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12.5,
                      marginBottom: 3,
                    }}
                  >
                    <span className="mono">{e.error_code}</span>
                    <span style={{ color: 'var(--quiet)' }}>{e.count}</span>
                  </div>
                  <div style={{ height: 5, background: '#f2efe9', borderRadius: 3 }}>
                    <div
                      style={{
                        width: `${(Number(e.count) / errorPeak) * 100}%`,
                        height: '100%',
                        background: '#c26a4f',
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 模型维度 */}
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>
          模型维度表现
        </h2>
        {models.length === 0 ? (
          <Empty text="暂无数据" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>执行数</th>
                <th>成功</th>
                <th>失败</th>
                <th>成功率</th>
                <th>平均耗时</th>
                <th>负反馈</th>
              </tr>
            </thead>
            <tbody>
              {models.map((x) => {
                const runs = Number(x.runs);
                const success = Number(x.success);
                const failed = Number(x.failed);
                return (
                  <tr key={String(x.model_version)}>
                    <td className="mono">{String(x.model_version)}</td>
                    <td>{runs}</td>
                    <td style={{ color: '#456135' }}>{success}</td>
                    <td style={{ color: failed > 0 ? '#a33b28' : 'inherit' }}>{failed}</td>
                    <td>{pct(runs ? success / runs : null)}</td>
                    <td>{ms(x.avg_duration_ms ? Number(x.avg_duration_ms) : null)}</td>
                    <td>{String(x.negative)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
