import Link from 'next/link';
import { listRuns, getFilterOptions } from '@/lib/queries/dashboard';
import {
  StatusTag,
  FeedbackTag,
  VerdictTag,
  Empty,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

function ms(v: number | null) {
  if (v === null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

export default async function RunsPage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await props.searchParams;
  const days = Number(sp.days ?? 7);
  const page = Number(sp.page ?? 1);

  const filters = {
    days,
    status: sp.status,
    feedback: sp.feedback,
    model: sp.model,
    errorCode: sp.error,
    reviewVerdict: sp.review,
    search: sp.q,
    page,
    pageSize: 50,
  };

  const [{ rows, total }, options] = await Promise.all([
    listRuns(filters),
    getFilterOptions(),
  ]);

  const buildHref = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v) next.set(k, v);
    }
    return `/runs?${next.toString()}`;
  };

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>运行列表</h1>
        <p style={{ color: 'var(--quiet)', fontSize: 13, margin: '4px 0 0' }}>
          共 {total} 条 Agent 执行记录，点任意一行进入复盘详情
        </p>
      </header>

      {/* 筛选 */}
      <form
        action="/runs"
        method="get"
        className="card"
        style={{
          padding: 12,
          marginBottom: 12,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <select name="days" defaultValue={String(days)}>
          {[1, 7, 14, 30, 90].map((d) => (
            <option key={d} value={d}>
              近 {d} 天
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ''}>
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">报错</option>
          <option value="timeout">超时</option>
          <option value="running">执行中</option>
        </select>
        <select name="feedback" defaultValue={sp.feedback ?? ''}>
          <option value="">全部反馈</option>
          <option value="negative">负向 👎</option>
          <option value="positive">正向 👍</option>
          <option value="none">无反馈</option>
        </select>
        <select name="review" defaultValue={sp.review ?? ''}>
          <option value="">全部评审状态</option>
          <option value="unreviewed">未评审</option>
          <option value="ok">已评审·正常</option>
          <option value="bad">已评审·坏例子</option>
          <option value="unsure">已评审·待定</option>
        </select>
        <select name="model" defaultValue={sp.model ?? ''}>
          <option value="">全部模型</option>
          {options.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select name="error" defaultValue={sp.error ?? ''}>
          <option value="">全部错误码</option>
          {options.errorCodes.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          placeholder="搜 request / session / message id"
          defaultValue={sp.q ?? ''}
          style={{ minWidth: 240 }}
        />
        <button type="submit" className="btn btn-primary">
          筛选
        </button>
        <Link href="/runs" className="btn">
          清空
        </Link>
      </form>

      {/* 快捷筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--quiet)', alignSelf: 'center' }}>
          快捷：
        </span>
        <Link href={buildHref({ feedback: 'negative', review: '', status: '' })} className="btn">
          只看负反馈
        </Link>
        <Link href={buildHref({ status: 'error', feedback: '', review: '' })} className="btn">
          只看报错
        </Link>
        <Link href={buildHref({ status: 'timeout', feedback: '', review: '' })} className="btn">
          只看超时
        </Link>
        <Link
          href={buildHref({ review: 'unreviewed', feedback: 'negative', status: '' })}
          className="btn"
        >
          负反馈待评审
        </Link>
      </div>

      {/* 表格 */}
      <div className="card" style={{ overflow: 'auto' }}>
        {rows.length === 0 ? (
          <Empty text="没有符合条件的记录，试试放宽筛选条件" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>状态</th>
                <th>耗时</th>
                <th>模型</th>
                <th>反馈</th>
                <th>评审</th>
                <th>Request ID</th>
                <th>错误码</th>
                <th>Retry</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.request_id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {r.started_at}
                  </td>
                  <td>
                    <StatusTag status={r.status} />
                  </td>
                  <td style={{ color: r.duration_ms && r.duration_ms > 8000 ? '#a33b28' : 'inherit' }}>
                    {ms(r.duration_ms)}
                  </td>
                  <td className="mono" style={{ color: 'var(--quiet)' }}>
                    {r.model_version ?? '—'}
                  </td>
                  <td>
                    <FeedbackTag value={r.last_feedback} />
                  </td>
                  <td>
                    <VerdictTag value={r.review_verdict} />
                  </td>
                  <td className="mono" style={{ color: 'var(--quiet)' }}>
                    {r.request_id.length > 22
                      ? `${r.request_id.slice(0, 22)}…`
                      : r.request_id}
                  </td>
                  <td className="mono" style={{ color: r.error_code ? '#a33b28' : '#c9c3b6' }}>
                    {r.error_code ?? '—'}
                  </td>
                  <td style={{ color: r.original_request_id ? '#8a6414' : '#c9c3b6' }}>
                    {r.original_request_id ? '重试' : '—'}
                  </td>
                  <td>
                    <Link href={`/runs/${encodeURIComponent(r.request_id)}`}>详情 →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            marginTop: 16,
            alignItems: 'center',
          }}
        >
          {page > 1 && (
            <Link href={buildHref({ page: String(page - 1) })} className="btn">
              ← 上一页
            </Link>
          )}
          <span style={{ fontSize: 13, color: 'var(--quiet)' }}>
            第 {page} / {totalPages} 页
          </span>
          {page < totalPages && (
            <Link href={buildHref({ page: String(page + 1) })} className="btn">
              下一页 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
