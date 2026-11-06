'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

// ============================================================
// 时间筛选：今日 / 近 7 天 / 近 30 天 / 自定义
// 状态放在 URL 上（from/to），刷新和分享都能还原。
// ============================================================

const PRESETS = [
  { key: 'today', label: '今日', days: 0 },
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '30d', label: '近 30 天', days: 30 },
];

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function DateRangePicker({
  from,
  to,
  today,
  active,
  dataFirst,
  dataLast,
}: {
  from: string;
  to: string;
  today: string;
  active: 'today' | '7d' | '30d' | 'custom';
  dataFirst: string | null;
  dataLast: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [open, setOpen] = useState(active === 'custom');

  const go = (q: Record<string, string>) => {
    const params = new URLSearchParams(sp.toString());
    params.delete('range');
    for (const [k, v] of Object.entries(q)) params.set(k, v);
    router.push(`/behavior?${params.toString()}`);
  };

  const pickPreset = (days: number) => {
    const end = new Date(today + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    go({ from: iso(start), to: iso(end) });
  };

  const btn = (isActive: boolean) => ({
    background: isActive ? '#f6f1ea' : '#fff',
    borderColor: isActive ? 'var(--clay)' : 'var(--line)',
    color: isActive ? 'var(--clay)' : 'var(--ink)',
  });

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className="btn"
          style={btn(active === p.key)}
          onClick={() => pickPreset(p.days)}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        className="btn"
        style={btn(active === 'custom' || open)}
        onClick={() => setOpen((v) => !v)}
      >
        自定义
      </button>

      {open && (
        <div
          className="card"
          style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 8px' }}
        >
          <input
            type="date"
            value={customFrom}
            min={dataFirst ?? undefined}
            max={today}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 5, padding: '3px 6px', fontSize: 12.5 }}
          />
          <span style={{ color: 'var(--quiet)', fontSize: 12 }}>至</span>
          <input
            type="date"
            value={customTo}
            min={dataFirst ?? undefined}
            max={today}
            onChange={(e) => setCustomTo(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 5, padding: '3px 6px', fontSize: 12.5 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!customFrom || !customTo || customFrom > customTo}
            onClick={() => go({ from: customFrom, to: customTo })}
          >
            应用
          </button>
        </div>
      )}

      <span style={{ fontSize: 11.5, color: '#a09a8d' }}>
        {from === to ? from : `${from} → ${to}`}
        {dataFirst && dataLast ? `（数据范围 ${dataFirst} ~ ${dataLast}）` : ''}
      </span>
    </div>
  );
}
