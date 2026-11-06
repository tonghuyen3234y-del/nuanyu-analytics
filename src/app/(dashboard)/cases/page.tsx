import Link from 'next/link';
import { listCases, getCaseStats } from '@/lib/queries/dashboard';
import {
  SeverityTag,
  CaseStatusTag,
  Empty,
  Metric,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CasesPage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await props.searchParams;
  const [cases, stats] = await Promise.all([
    listCases({
      status: sp.status,
      severity: sp.severity,
      category: sp.category,
      search: sp.q,
    }),
    getCaseStats(),
  ]);

  const buildHref = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/cases?${qs}` : '/cases';
  };

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Case 集</h1>
        <p style={{ color: 'var(--quiet)', fontSize: 13, margin: '4px 0 0' }}>
          人工确认的 Bad Case，可直接导出作为评测集
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Metric label="Case 总数" value={stats.total ?? 0} />
        <Metric
          label="待处理"
          value={stats.open ?? 0}
          tone={Number(stats.open) > 0 ? 'warn' : 'good'}
        />
        <Metric label="修复中" value={stats.fixing ?? 0} />
        <Metric label="已修复" value={stats.fixed ?? 0} tone="good" />
        <Metric label="P0 严重" value={stats.p0 ?? 0} tone={Number(stats.p0) > 0 ? 'bad' : 'plain'} />
      </div>

      <form
        action="/cases"
        method="get"
        className="card"
        style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <select name="status" defaultValue={sp.status ?? ''}>
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="fixing">修复中</option>
          <option value="fixed">已修复</option>
          <option value="wontfix">不修复</option>
        </select>
        <select name="severity" defaultValue={sp.severity ?? ''}>
          <option value="">全部优先级</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
        </select>
        <select name="category" defaultValue={sp.category ?? ''}>
          <option value="">全部分类</option>
          {stats.categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category} ({c.count})
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          placeholder="搜标题或描述"
          defaultValue={sp.q ?? ''}
          style={{ minWidth: 220 }}
        />
        <button className="btn btn-primary" type="submit">
          筛选
        </button>
        <Link href="/cases" className="btn">
          清空
        </Link>
        <a
          href="/api/dashboard/cases/export"
          className="btn"
          style={{ marginLeft: 'auto' }}
          download
        >
          导出 JSON
        </a>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cases.length === 0 ? (
          <div className="card">
            <Empty text="还没有 Case。去运行列表挑一条负反馈记录，点「记为 Bad Case」" />
          </div>
        ) : (
          cases.map((c) => {
            const x = c as Record<string, unknown>;
            return (
              <div key={String(x.id)} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7 }}>
                  <SeverityTag value={x.severity as string} />
                  <CaseStatusTag value={String(x.status)} />
                  <span className="tag" style={{ background: '#f2efe9', color: '#6b6252' }}>
                    {String(x.category ?? '未分类')}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 11.5, color: '#a8a296' }}>
                    {String(x.run_started_at)}
                  </span>
                </div>

                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  {String(x.title)}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--quiet)',
                    lineHeight: 1.7,
                    marginBottom: 8,
                  }}
                >
                  {String(x.description)}
                </div>
                {Boolean(x.expected_behavior) && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--sage)',
                      lineHeight: 1.7,
                      padding: '6px 10px',
                      background: '#f4f7f1',
                      borderRadius: 5,
                      marginBottom: 8,
                    }}
                  >
                    期望行为：{String(x.expected_behavior)}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    fontSize: 11.5,
                    color: '#a8a296',
                    alignItems: 'center',
                    paddingTop: 8,
                    borderTop: '1px solid #f0ece4',
                  }}
                >
                  <span>负责人 {String(x.owner ?? '未分配')}</span>
                  {Boolean(x.fix_version) && <span>修复版本 {String(x.fix_version)}</span>}
                  <span>创建人 {String(x.created_by)}</span>
                  <span style={{ flex: 1 }} />
                  <Link
                    href={`/runs/${encodeURIComponent(String(x.request_id))}`}
                    style={{ fontSize: 12.5 }}
                  >
                    查看原始执行 →
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
