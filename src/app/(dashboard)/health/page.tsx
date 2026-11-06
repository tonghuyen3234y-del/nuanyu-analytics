import { runHealthChecks } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

const STYLE = {
  pass: { bg: '#e8f0e4', fg: '#456135', icon: '✓', text: '通过' },
  warn: { bg: '#fdf2de', fg: '#8a6414', icon: '!', text: '需关注' },
  fail: { bg: '#fbe9e6', fg: '#a33b28', icon: '✕', text: '不通过' },
} as const;

const ACCEPTANCE_MAP: Record<string, string> = {
  A05: 'A05 网络重试同一埋点上报两次，event_id 去重',
  A07: 'A07 检查事件记录，公共必填字段完整、类型正确',
  'A07b': 'A07 时间口径统一',
  E04: '04.1 业务扩展字段必填校验',
  E05: '04.1 规范化错误码',
  E06: 'E06 反馈可关联到对应回答',
  '03.1': '03.1 未正常结束的运行需超时兜底',
  A10: 'A10 事件数据不默认落原文',
  '05.1': '05.1 坏例子率分母为全部已评审请求',
  A11: '05.2 用户行为分析需要可去重的用户标识',
};

export default async function HealthPage() {
  const checks = await runHealthChecks(7);
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>埋点自检</h1>
        <p style={{ color: 'var(--quiet)', fontSize: 13, margin: '4px 0 0' }}>
          对应《埋点需求文档》第 06 章验收标准，用于研发联调和 PM 签字前的自动核对
        </p>
      </header>

      <div
        className="card"
        style={{
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          gap: 22,
          alignItems: 'center',
        }}
      >
        <div>
          <span style={{ fontSize: 13, color: 'var(--quiet)' }}>总体状态　</span>
          <b
            style={{
              fontSize: 16,
              color: failCount > 0 ? '#a33b28' : '#456135',
            }}
          >
            {passCount} / {checks.length} 通过
          </b>
        </div>
        {failCount > 0 && (
          <span style={{ fontSize: 13, color: '#a33b28' }}>
            有 {failCount} 项不通过，需修复后才能签字验收
          </span>
        )}
        {failCount === 0 && (
          <span style={{ fontSize: 13, color: 'var(--quiet)' }}>
            无阻断问题。人工核对数据后即可签字。
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {checks.map((c) => {
          const s = STYLE[c.status];
          return (
            <div
              key={c.id}
              className="card"
              style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start' }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: s.bg,
                  color: s.fg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span
                    className="tag"
                    style={{ background: '#f2efe9', color: '#6b6252', fontWeight: 600 }}
                  >
                    {c.id}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</span>
                  <span className="tag" style={{ background: s.bg, color: s.fg }}>
                    {s.text}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--quiet)', lineHeight: 1.7 }}>
                  {c.detail}
                </div>
                {ACCEPTANCE_MAP[c.id] && (
                  <div style={{ fontSize: 11.5, color: '#b0aa9d', marginTop: 4 }}>
                    对应验收项：{ACCEPTANCE_MAP[c.id]}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <section className="card" style={{ padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>
          手工验收清单（文档 06 章）
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>测试步骤</th>
              <th>预期结果</th>
              <th>本项目对应</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['A01', '新建一段会话', 'E01 仅 1 条，session_id 正确', 'POST /api/v1/events + event_id 幂等'],
              ['A02', '发送 1 条消息并得到回答', 'E02、E03、E04 均产生且可关联', 'agent-runs start → end'],
              ['A03', '模拟 Agent 超时', 'E05 产生；标记 timeout，不计成功', 'agent-runs end status=timeout'],
              ['A04', '对回答提交差评', 'E06 的 request_id 指向该回答', 'events feedback_submit'],
              ['A05', '网络重试同一上报两次', 'event_id 去重，只计 1 次', '✅ 已自动校验'],
              ['A06', '用户点击重试', 'E07 有原 request_id，新执行有新 ID', 'events retry_click + original_request_id'],
              ['A07', '检查 10 条事件记录', '公共必填字段完整、时间统一', '✅ 已自动校验'],
              ['A08', '核对库与看板', '计数一致', '看板直查 DB，天然一致'],
              ['A09', '模拟无权限访问', '被拒绝', 'x-api-key 鉴权'],
              ['A10', '发送含敏感信息消息', '不落原文、看板不泄露', '✅ 白名单过滤 + PII 开关'],
              ['A11', '同账号换设备进产品', '活跃/留存按用户去重，不重复计人', 'events 带 user_id_hash → /behavior'],
            ].map(([id, step, expect, impl]) => (
              <tr key={id}>
                <td className="mono">{id}</td>
                <td>{step}</td>
                <td style={{ color: 'var(--quiet)' }}>{expect}</td>
                <td style={{ color: 'var(--sage)', fontSize: 12 }}>{impl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
