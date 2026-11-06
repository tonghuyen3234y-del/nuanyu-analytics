import type { ReactNode } from 'react';

// ============================================================
// 状态与标签的展示组件
// ============================================================

const STATUS_STYLE: Record<string, { bg: string; fg: string; text: string }> = {
  success: { bg: '#e8f0e4', fg: '#456135', text: '成功' },
  error: { bg: '#fbe9e6', fg: '#a33b28', text: '报错' },
  timeout: { bg: '#fdf2de', fg: '#8a6414', text: '超时' },
  running: { bg: '#e8edf5', fg: '#3a5578', text: '执行中' },
};

export function StatusTag({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? {
    bg: '#eeebe5',
    fg: '#5f594e',
    text: status,
  };
  return (
    <span className="tag" style={{ background: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
}

export function FeedbackTag({ value }: { value: string | null }) {
  if (!value) return <span style={{ color: '#bdb7ab' }}>—</span>;
  const neg = value === 'negative';
  return (
    <span
      className="tag"
      style={{
        background: neg ? '#fbe9e6' : '#e8f0e4',
        color: neg ? '#a33b28' : '#456135',
      }}
    >
      {neg ? '👎 负向' : '👍 正向'}
    </span>
  );
}

export function VerdictTag({ value }: { value: string | null }) {
  if (!value)
    return (
      <span className="tag" style={{ background: '#f2efe9', color: '#918a7c' }}>
        未评审
      </span>
    );
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    ok: { bg: '#e8f0e4', fg: '#456135', text: '正常' },
    bad: { bg: '#fbe9e6', fg: '#a33b28', text: '坏例子' },
    unsure: { bg: '#fdf2de', fg: '#8a6414', text: '待定' },
  };
  const s = map[value] ?? map.unsure;
  return (
    <span className="tag" style={{ background: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
}

export function SeverityTag({ value }: { value: string | null }) {
  if (!value) return null;
  const map: Record<string, { bg: string; fg: string }> = {
    P0: { bg: '#a33b28', fg: '#fff' },
    P1: { bg: '#e0a04a', fg: '#fff' },
    P2: { bg: '#c9c3b6', fg: '#4b4639' },
  };
  const s = map[value] ?? map.P2;
  return (
    <span className="tag" style={{ background: s.bg, color: s.fg, fontWeight: 600 }}>
      {value}
    </span>
  );
}

export function CaseStatusTag({ value }: { value: string }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    open: { bg: '#fbe9e6', fg: '#a33b28', text: '待处理' },
    fixing: { bg: '#fdf2de', fg: '#8a6414', text: '修复中' },
    fixed: { bg: '#e8f0e4', fg: '#456135', text: '已修复' },
    wontfix: { bg: '#f2efe9', fg: '#918a7c', text: '不修复' },
  };
  const s = map[value] ?? map.open;
  return (
    <span className="tag" style={{ background: s.bg, color: s.fg }}>
      {s.text}
    </span>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'bad' | 'warn' | 'plain';
}) {
  const color =
    tone === 'bad' ? '#a33b28' : tone === 'good' ? '#456135' : tone === 'warn' ? '#8a6414' : 'var(--ink)';
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 12.5, color: 'var(--quiet)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color, lineHeight: 1.2 }}>{value}</div>
      {hint && (
        <div style={{ fontSize: 11.5, color: '#a09a8d', marginTop: 5, lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '48px 0',
        textAlign: 'center',
        color: '#a09a8d',
        fontSize: 13.5,
      }}
    >
      {text}
    </div>
  );
}

/** 简易横向条形图，不引图表库，减少依赖 */
export function BarChart({
  data,
  max,
  color = 'var(--clay)',
  height = 140,
}: {
  data: { label: string; value: number; sub?: string }[];
  max?: number;
  color?: string;
  height?: number;
}) {
  const peak = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 3,
        height,
        paddingTop: 8,
      }}
    >
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.label}：${d.value}${d.sub ? `（${d.sub}）` : ''}`}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            minWidth: 0,
          }}
        >
          <div
            style={{
              height: Math.max(2, (d.value / peak) * (height - 26)),
              background: d.value === 0 ? '#ece8df' : color,
              borderRadius: 2,
              transition: 'height .2s',
            }}
          />
          <div
            style={{
              fontSize: 9,
              color: '#a8a296',
              textAlign: 'center',
              marginTop: 4,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {d.label.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}
