import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRunDetail } from '@/lib/queries/dashboard';
import {
  StatusTag,
  FeedbackTag,
  VerdictTag,
  SeverityTag,
  CaseStatusTag,
} from '@/components/ui';
import { ReviewPanel, CreateCasePanel, RevealText } from '@/components/RunActions';

export const dynamic = 'force-dynamic';

function ms(v: unknown) {
  const n = v === null || v === undefined ? null : Number(v);
  if (n === null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${n}ms`;
}

const EVENT_LABEL: Record<string, { text: string; color: string }> = {
  session_start: { text: 'E01 会话开始', color: '#6f7d5e' },
  message_send: { text: 'E02 消息发送', color: '#6f7d5e' },
  agent_request_start: { text: 'E03 开始执行', color: '#3a5578' },
  agent_response: { text: 'E04 执行成功', color: '#456135' },
  agent_error: { text: 'E05 执行失败', color: '#a33b28' },
  feedback_submit: { text: 'E06 用户反馈', color: '#8a6414' },
  retry_click: { text: 'E07 点击重试', color: '#8a6414' },
  session_end: { text: 'E08 会话结束', color: '#6f7d5e' },
};

export default async function RunDetailPage(props: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await props.params;
  const data = await getRunDetail(decodeURIComponent(requestId));
  if (!data) notFound();

  const { run, timeline, feedbacks, sessionRuns } = data;
  const r = run as Record<string, unknown>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Link href="/runs" style={{ fontSize: 13 }}>
          ← 返回列表
        </Link>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>执行详情</h1>
        <StatusTag status={String(r.status)} />
        <FeedbackTag value={r.last_feedback as string | null} />
        <VerdictTag value={r.review_verdict as string | null} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14 }}>
        {/* 左：主体信息 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 基础信息 */}
          <section className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>基础信息</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                gap: 12,
                fontSize: 12.5,
              }}
            >
              {[
                ['Request ID', String(r.request_id)],
                ['Session ID', String(r.session_id)],
                ['Message ID', String(r.message_id)],
                ['开始时间', String(r.started_at_local ?? '—')],
                ['结束时间', String(r.ended_at_local ?? '—')],
                ['耗时', ms(r.duration_ms)],
                ['模型版本', String(r.model_version ?? '—')],
                ['Prompt 版本', String(r.prompt_version ?? '—')],
                ['错误码', String(r.error_code ?? '—')],
                ['错误信息', String(r.error_message ?? '—')],
                ['重试来源', String(r.original_request_id ?? '—')],
                ['是否自动重试', r.is_auto_retry ? '是' : '否'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ color: 'var(--quiet)', fontSize: 11.5, marginBottom: 2 }}>{k}</div>
                  <div
                    className={k.includes('ID') ? 'mono' : ''}
                    style={{ wordBreak: 'break-all', lineHeight: 1.5 }}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 时间线 */}
          <section className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>事件时间线</h2>
            <p style={{ fontSize: 11.5, color: 'var(--quiet)', margin: '0 0 14px' }}>
              该 request_id 关联的全部埋点事件，按发生时间排序
            </p>
            {timeline.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#a8a296' }}>没有关联事件</div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 18 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 6,
                    bottom: 6,
                    width: 1,
                    background: 'var(--line)',
                  }}
                />
                {timeline.map((t, i) => {
                  const label = EVENT_LABEL[t.event_name] ?? {
                    text: t.event_name,
                    color: '#918a7c',
                  };
                  return (
                    <div key={i} style={{ position: 'relative', marginBottom: 12 }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: -16,
                          top: 5,
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: label.color,
                        }}
                      />
                      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                        <span className="mono" style={{ color: 'var(--quiet)', fontSize: 11.5 }}>
                          {t.at}
                        </span>
                        <span
                          style={{ fontSize: 12.5, fontWeight: 500, color: label.color }}
                        >
                          {label.text}
                        </span>
                        <span
                          className="tag"
                          style={{ background: '#f2efe9', color: '#918a7c', fontSize: 11 }}
                        >
                          {t.source === 'web' ? '前端' : '服务端'}
                        </span>
                      </div>
                      {t.detail && t.detail !== '{}' && (
                        <div
                          className="mono"
                          style={{
                            color: 'var(--quiet)',
                            fontSize: 11.5,
                            marginTop: 3,
                            marginLeft: 0,
                          }}
                        >
                          {t.detail}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 内容 */}
          <section className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>对话内容</h2>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--quiet)', marginBottom: 6 }}>
                用户输入
              </div>
              <RevealText text={r.input_text as string | null} label="输入" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--quiet)', marginBottom: 6 }}>
                AI 输出
              </div>
              <RevealText text={r.output_text as string | null} label="输出" />
            </div>
          </section>

          {/* 同会话其他执行 */}
          <section className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>
              本会话的其他执行（{sessionRuns.length} 次）
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sessionRuns.map((s) => {
                const sid = String((s as Record<string, unknown>).request_id);
                const cur = sid === String(r.request_id);
                return (
                  <Link
                    key={sid}
                    href={`/runs/${encodeURIComponent(sid)}`}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      fontSize: 12.5,
                      padding: '6px 9px',
                      borderRadius: 6,
                      background: cur ? '#f6f1ea' : 'transparent',
                      color: 'inherit',
                      textDecoration: 'none',
                      border: cur ? '1px solid #e8dcc4' : '1px solid transparent',
                    }}
                  >
                    <span className="mono" style={{ color: 'var(--quiet)' }}>
                      {String((s as Record<string, unknown>).started_at)}
                    </span>
                    <StatusTag status={String((s as Record<string, unknown>).status)} />
                    <span className="mono" style={{ color: 'var(--quiet)', flex: 1 }}>
                      {sid.slice(0, 28)}…
                    </span>
                    {Boolean((s as Record<string, unknown>).last_feedback) && (
                      <FeedbackTag
                        value={(s as Record<string, unknown>).last_feedback as string}
                      />
                    )}
                    {cur && <span style={{ color: 'var(--clay)', fontSize: 11.5 }}>当前</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        </div>

        {/* 右：操作区 */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>用户反馈</h3>
            {feedbacks.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#a8a296' }}>暂无反馈</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {feedbacks.map((f, i) => {
                  const ff = f as Record<string, unknown>;
                  return (
                    <div key={i} style={{ fontSize: 12.5 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <FeedbackTag value={String(ff.value)} />
                        <span className="mono" style={{ color: 'var(--quiet)', fontSize: 11.5 }}>
                          {String(ff.created_at)}
                        </span>
                      </div>
                      {Boolean(ff.comment) && (
                        <div style={{ marginTop: 4, color: 'var(--quiet)' }}>
                          {String(ff.comment)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {Boolean(r.review_at) && (
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 8px' }}>已评审</h3>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                <div>
                  结论：<VerdictTag value={r.review_verdict as string | null} />
                </div>
                <div style={{ color: 'var(--quiet)' }}>
                  {String(r.review_reviewer)} · {String(r.review_at)}
                </div>
                {Boolean(r.review_note) && (
                  <div style={{ marginTop: 6 }}>{String(r.review_note)}</div>
                )}
              </div>
            </div>
          )}

          {Boolean(r.case_id) && (
            <div className="card" style={{ padding: 14, background: '#fdf6f3', borderColor: '#efd8ce' }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 8px', color: '#a33b28' }}>
                Case 信息
              </h3>
              <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <SeverityTag value={r.case_severity as string | null} />
                  <CaseStatusTag value={String(r.case_status)} />
                  <span className="tag" style={{ background: '#f2efe9', color: '#6b6252' }}>
                    {String(r.case_category ?? '未分类')}
                  </span>
                </div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{String(r.case_title)}</div>
                <div style={{ color: 'var(--quiet)', marginBottom: 4 }}>
                  {String(r.case_description)}
                </div>
                {Boolean(r.case_expected) && (
                  <div style={{ color: 'var(--sage)' }}>
                    期望：{String(r.case_expected)}
                  </div>
                )}
                <div style={{ color: 'var(--quiet)', fontSize: 11.5, marginTop: 6 }}>
                  负责人 {String(r.case_owner ?? '未分配')}
                  {Boolean(r.case_fix_version) && ` · 修复版本 ${String(r.case_fix_version)}`}
                </div>
              </div>
            </div>
          )}

          <CreateCasePanel
            requestId={String(r.request_id)}
            existingCaseId={(r.case_id as string | null) ?? null}
            existingCaseTitle={(r.case_title as string | null) ?? null}
          />

          <ReviewPanel
            requestId={String(r.request_id)}
            currentVerdict={(r.review_verdict as string | null) ?? null}
            currentNote={(r.review_note as string | null) ?? null}
            currentReviewer={(r.review_reviewer as string | null) ?? null}
          />
        </aside>
      </div>
    </div>
  );
}
