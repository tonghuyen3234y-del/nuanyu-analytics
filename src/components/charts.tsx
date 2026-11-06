'use client';

import { useEffect, useRef, useState } from 'react';
import { SERIES_COLORS, fmtPct } from '@/lib/format';

// ============================================================
// 用户行为分析图表
// 交互优先：
// - 悬停/拖拽/键盘 ← → 都能移动游标，十字准线跟手，0 延迟
// - 浮层一次列出当天全部序列，而不是只显示一条
// - 点击某一天回调 onSelectDay，供页面做跨模块联动
// ============================================================

export { SERIES_COLORS, fmtPct };

const AXIS = '#e8e3d9';
const QUIET = '#a8a296';

// ------------------------------------------------------------
// 内部：把指针位置换算成数据下标
// ------------------------------------------------------------
function useActiveIndex(count: number) {
  const [idx, setIdx] = useState<number | null>(null);
  return { idx, setIdx, count };
}

function Tooltip({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 贴近视口右/下边缘时翻到另一侧，避免溢出
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 14;
    let left = x + margin;
    let top = y - h / 2;
    if (left + w > window.innerWidth - 8) left = x - w - margin;
    if (top < 8) top = 8;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    setPos({ left, top });
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 60,
        pointerEvents: 'none',
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(6px)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        boxShadow: '0 6px 22px rgba(60,48,32,.13)',
        padding: '8px 11px',
        fontSize: 12,
        color: 'var(--ink)',
        minWidth: 132,
        lineHeight: 1.7,
      }}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------
// 折线图
// ------------------------------------------------------------
export interface LineSeries {
  name: string;
  label: string;
  color?: string;
  points: { day: string; value: number }[];
}

export function LineChart({
  series,
  height = 180,
  formatValue = (v: number) => String(v),
  yMax,
  showArea = false,
  onSelectDay,
  activeDay,
}: {
  series: LineSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  yMax?: number;
  showArea?: boolean;
  onSelectDay?: (day: string) => void;
  activeDay?: string | null;
}) {
  const labels = series[0]?.points.map((p) => p.day) ?? [];
  const { idx, setIdx } = useActiveIndex(labels.length);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const peak = yMax ?? Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const W = 760;
  const H = height;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const x = (i: number) => padL + (labels.length > 1 ? i * step : innerW / 2);
  const y = (v: number) => padT + innerH - (v / peak) * innerH;

  const indexFromEvent = (e: { clientX: number }) => {
    const svg = svgRef.current;
    if (!svg || labels.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    // 换算到 viewBox 坐标
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const raw = step > 0 ? (vx - padL) / step : 0;
    return Math.max(0, Math.min(labels.length - 1, Math.round(raw)));
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!dragging.current && e.pointerType !== 'mouse') return;
    const i = indexFromEvent(e);
    if (i === null) return;
    setIdx(i);
    setPointer({ x: e.clientX, y: e.clientY });
  };

  // 键盘导航：← → 移动游标，Esc 取消
  const handleKey = (e: React.KeyboardEvent) => {
    if (labels.length === 0) return;
    const cur = idx ?? labels.length - 1;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setIdx(Math.max(0, cur - 1));
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPointer({ x: r.left + (x(Math.max(0, cur - 1)) / W) * r.width, y: r.top + 40 });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setIdx(Math.min(labels.length - 1, cur + 1));
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPointer({ x: r.left + (x(Math.min(labels.length - 1, cur + 1)) / W) * r.width, y: r.top + 40 });
    } else if (e.key === 'Escape') {
      setIdx(null);
      setPointer(null);
    }
  };

  const activeIdx = idx !== null && idx < labels.length ? idx : null;
  const pinnedIdx =
    activeDay != null ? labels.findIndex((l) => l === activeDay || activeDay.endsWith(l)) : -1;

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        tabIndex={0}
        onKeyDown={handleKey}
        onPointerMove={handleMove}
        onPointerDown={(e) => {
          dragging.current = true;
          // 触摸/点击时立即定位并锁定
          const i = indexFromEvent(e);
          if (i !== null) {
            setIdx(i);
            setPointer({ x: e.clientX, y: e.clientY });
            onSelectDay?.(labels[i]);
          }
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerLeave={() => {
          dragging.current = false;
          setIdx(null);
          setPointer(null);
        }}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          overflow: 'visible',
          cursor: 'crosshair',
          outline: 'none',
          touchAction: 'pan-y',
        }}
        role="img"
        aria-label={`趋势图，共 ${labels.length} 天，可用左右方向键逐日查看`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={W - padR}
              y1={padT + innerH * g}
              y2={padT + innerH * g}
              stroke={AXIS}
              strokeWidth={1}
            />
            <text x={padL - 6} y={padT + innerH * g + 3.5} fontSize={9} fill={QUIET} textAnchor="end">
              {formatValue(peak * (1 - g))}
            </text>
          </g>
        ))}

        {/* 选中日（来自其他模块联动） */}
        {pinnedIdx >= 0 && (
          <line
            x1={x(pinnedIdx)}
            x2={x(pinnedIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke="var(--clay)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        )}

        {/* 十字准线 */}
        {activeIdx !== null && (
          <line
            x1={x(activeIdx)}
            x2={x(activeIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke="#c9c3b6"
            strokeWidth={1}
          />
        )}

        {series.map((s, si) => {
          const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length];
          // 多条线数值相同时会完全重合，给一点纵向错位让每条都能看见
          const jitter = si * 1.1;
          const d = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${(y(p.value) + jitter).toFixed(1)}`)
            .join(' ');
          const area = `${d} L${x(s.points.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`;
          return (
            <g key={s.name}>
              {showArea && <path d={area} fill={color} opacity={0.08} />}
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.8}
                strokeLinejoin="round"
                opacity={activeIdx === null ? 1 : 1}
              />
              {s.points.map((p, i) => {
                const isActive = activeIdx === i;
                return (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(p.value) + jitter}
                    r={isActive ? 4 : 2.2}
                    fill={isActive ? '#fff' : color}
                    stroke={isActive ? color : 'none'}
                    strokeWidth={isActive ? 2 : 0}
                  />
                );
              })}
            </g>
          );
        })}

        {labels.map((l, i) => {
          const every = Math.ceil(labels.length / 12);
          if (i % every !== 0 && i !== labels.length - 1) return null;
          return (
            <text
              key={i}
              x={x(i)}
              y={H - 5}
              fontSize={9}
              fill={activeIdx === i ? 'var(--clay)' : QUIET}
              fontWeight={activeIdx === i ? 600 : 400}
              textAnchor="middle"
            >
              {l}
            </text>
          );
        })}
      </svg>

      {activeIdx !== null && pointer && (
        <Tooltip x={pointer.x} y={pointer.y}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{labels[activeIdx]}</div>
          {series.map((s, si) => (
            <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: 'var(--quiet)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    display: 'inline-block',
                    background: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length],
                  }}
                />
                {s.label}
              </span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatValue(s.points[activeIdx]?.value ?? 0)}
              </b>
            </div>
          ))}
        </Tooltip>
      )}

      <Legend series={series} />
    </div>
  );
}

function Legend({ series }: { series: LineSeries[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8 }}>
      {series.map((s, si) => (
        <span
          key={s.name}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--quiet)' }}
        >
          <i
            style={{
              width: 14,
              height: 2.5,
              borderRadius: 2,
              background: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length],
              display: 'inline-block',
            }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// 分组柱状图
// ------------------------------------------------------------
export function GroupedBarChart({
  data,
  series,
  height = 190,
  formatValue = (v: number) => String(v),
  onSelectDay,
}: {
  data: { day: string; values: number[] }[];
  series: { label: string; color?: string }[];
  height?: number;
  formatValue?: (v: number) => string;
  onSelectDay?: (day: string) => void;
}) {
  const [idx, setIdx] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const peak = Math.max(1, ...data.flatMap((d) => d.values));
  const W = 760;
  const H = height;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = data.length > 0 ? innerW / data.length : innerW;
  const barW = Math.max(2, Math.min(14, (slot * 0.62) / Math.max(1, series.length)));

  const indexFromEvent = (e: { clientX: number }) => {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(data.length - 1, Math.floor((vx - padL) / slot)));
  };

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={(e) => {
          const i = indexFromEvent(e);
          if (i === null) return;
          setIdx(i);
          setPointer({ x: e.clientX, y: e.clientY });
        }}
        onPointerLeave={() => {
          setIdx(null);
          setPointer(null);
        }}
        onClick={(e) => {
          const i = indexFromEvent(e);
          if (i !== null && onSelectDay) onSelectDay(data[i].day);
        }}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible', cursor: onSelectDay ? 'pointer' : 'default' }}
        role="img"
      >
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={padT + innerH * g} y2={padT + innerH * g} stroke={AXIS} />
            <text x={padL - 6} y={padT + innerH * g + 3.5} fontSize={9} fill={QUIET} textAnchor="end">
              {formatValue(peak * (1 - g))}
            </text>
          </g>
        ))}

        {idx !== null && data[idx] && (
          <rect
            x={padL + slot * idx}
            y={padT}
            width={slot}
            height={innerH}
            fill="var(--clay)"
            opacity={0.05}
            rx={3}
          />
        )}

        {data.map((d, di) => {
          const cx = padL + slot * di + slot / 2;
          const groupW = barW * series.length + 2 * (series.length - 1);
          const dim = idx !== null && idx !== di;
          return (
            <g key={d.day}>
              {d.values.map((v, si) => {
                const h = Math.max(1, (v / peak) * innerH);
                const bx = cx - groupW / 2 + si * (barW + 2);
                const color = series[si]?.color ?? SERIES_COLORS[si % SERIES_COLORS.length];
                return (
                  <rect
                    key={si}
                    x={bx}
                    y={padT + innerH - h}
                    width={barW}
                    height={h}
                    rx={1.5}
                    fill={v === 0 ? '#ece8df' : color}
                    opacity={dim ? 0.45 : 1}
                  />
                );
              })}
              {(di % Math.ceil(data.length / 12) === 0 || di === data.length - 1) && (
                <text
                  x={cx}
                  y={H - 6}
                  fontSize={9}
                  fill={idx === di ? 'var(--clay)' : QUIET}
                  fontWeight={idx === di ? 600 : 400}
                  textAnchor="middle"
                >
                  {d.day}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {idx !== null && data[idx] && pointer && (
        <Tooltip x={pointer.x} y={pointer.y}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{data[idx].day}</div>
          {series.map((s, si) => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: 'var(--quiet)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    display: 'inline-block',
                    background: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length],
                  }}
                />
                {s.label}
              </span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatValue(data[idx].values[si] ?? 0)}
              </b>
            </div>
          ))}
        </Tooltip>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 8 }}>
        {series.map((s, si) => (
          <span
            key={s.label}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--quiet)' }}
          >
            <i
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length],
                display: 'inline-block',
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 横向条形（功能使用占比）
// ------------------------------------------------------------
export function HBar({
  rows,
  formatValue,
  onSelect,
  selected,
}: {
  rows: { label: string; value: number; share: number; key?: string; color?: string; title?: string }[];
  formatValue?: (v: number) => string;
  onSelect?: (key: string) => void;
  selected?: string | null;
}) {
  const peak = Math.max(1, ...rows.map((r) => r.share));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => {
        const isSelected = selected != null && r.key === selected;
        return (
          <div
            key={r.label}
            title={r.title}
            onClick={() => r.key && onSelect?.(r.key)}
            style={{
              cursor: r.key && onSelect ? 'pointer' : 'default',
              padding: '2px 4px',
              margin: '0 -4px',
              borderRadius: 5,
              background: isSelected ? '#f6f1ea' : 'transparent',
              transition: 'background .15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
              <span style={{ color: isSelected ? 'var(--clay)' : 'inherit', fontWeight: isSelected ? 600 : 400 }}>
                {r.label}
              </span>
              <span style={{ color: 'var(--quiet)' }}>
                {formatValue ? formatValue(r.value) : r.value}
                <span style={{ color: '#c0bab0', marginLeft: 6 }}>{(r.share * 100).toFixed(1)}%</span>
              </span>
            </div>
            <div style={{ height: 6, background: '#f2efe9', borderRadius: 3 }}>
              <div
                style={{
                  width: `${(r.share / peak) * 100}%`,
                  height: '100%',
                  borderRadius: 3,
                  background: r.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
                  opacity: selected && !isSelected ? 0.45 : 1,
                  transition: 'opacity .15s, width .25s',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// 漏斗（可点击钻取）
// ------------------------------------------------------------
export function FunnelChart({
  steps,
  onSelect,
  activeKey,
}: {
  steps: {
    key: string;
    label: string;
    hint: string;
    users: number;
    step_rate: number | null;
    total_rate: number | null;
    drop_rate: number | null;
    dropped: number;
  }[];
  onSelect?: (key: string) => void;
  activeKey?: string | null;
}) {
  const first = steps[0]?.users ?? 0;
  const [mounted, setMounted] = useState(false);

  // 首次渲染后展开，给出"条在长出来"的手感
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((s, i) => {
        const width = first > 0 ? Math.max(6, (s.users / first) * 100) : 6;
        const worst = Math.max(...steps.slice(1).map((x) => x.drop_rate ?? 0));
        const isWorst = i > 0 && (s.drop_rate ?? 0) === worst && (s.drop_rate ?? 0) > 0.1;
        const isActive = activeKey === s.key;
        return (
          <div key={s.key}>
            {i > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 0 0 12px',
                  margin: '6px 0',
                  fontSize: 11.5,
                  color: (s.drop_rate ?? 0) > 0.1 ? '#a33b28' : 'var(--quiet)',
                }}
              >
                <span style={{ fontSize: 11 }}>↓</span>
                流失 {s.dropped} 人
                {s.drop_rate !== null && <span>（{fmtPct(s.drop_rate)}）</span>}
                {isWorst && (
                  <span className="tag" style={{ background: '#fbe9e6', color: '#a33b28' }}>
                    最大流失点
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => onSelect?.(s.key)}
              title={s.hint}
              style={{
                position: 'relative',
                width: '100%',
                textAlign: 'left',
                background: isActive ? '#f6f1ea' : '#fff',
                border: `1px solid ${isActive ? 'var(--clay)' : 'var(--line)'}`,
                borderRadius: 6,
                overflow: 'hidden',
                cursor: onSelect ? 'pointer' : 'default',
                padding: 0,
                font: 'inherit',
                transition: 'border-color .15s, background .15s',
              }}
            >
              <div
                style={{
                  width: `${mounted ? width : 0}%`,
                  minWidth: 90,
                  background: isWorst ? '#a33b28' : '#b3663f',
                  opacity: 0.13 + 0.06 * (steps.length - i),
                  position: 'absolute',
                  inset: 0,
                  transition: `width .45s cubic-bezier(.22,.9,.24,1) ${i * 55}ms`,
                }}
              />
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '9px 12px',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {i + 1}. {s.label}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{s.users}</div>
                  <div style={{ fontSize: 11, color: 'var(--quiet)' }}>
                    {s.step_rate === null ? '起点' : fmtPct(s.step_rate)}
                  </div>
                </div>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// 留存矩阵（格子可点）
// ------------------------------------------------------------
export function RetentionMatrix({
  rows,
  maxOffset,
  onSelectCell,
  activeCell,
}: {
  rows: { day: string; cohort: number; d: (number | null)[] }[];
  maxOffset: number;
  onSelectCell?: (day: string, offset: number) => void;
  activeCell?: { day: string; offset: number } | null;
}) {
  const cell = (v: number | null) => {
    if (v === null) return { bg: '#faf8f4', fg: '#d8d2c7', text: '—' };
    const t = Math.min(1, v / 0.5);
    const r = Math.round(255 - t * 40);
    const g = Math.round(243 - t * 130);
    const b = Math.round(232 - t * 160);
    return { bg: `rgb(${r},${g},${b})`, fg: t > 0.55 ? '#fff' : '#5f594e', text: `${(v * 100).toFixed(0)}%` };
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--quiet)', fontWeight: 600 }}>新增日</th>
            <th style={{ padding: '4px 8px', color: 'var(--quiet)', fontWeight: 600 }}>人数</th>
            {Array.from({ length: maxOffset + 1 }, (_, i) => (
              <th key={i} style={{ padding: '4px 6px', color: 'var(--quiet)', fontWeight: 600 }}>
                D{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <td className="mono" style={{ padding: '3px 8px', color: 'var(--quiet)', whiteSpace: 'nowrap' }}>
                {row.day.slice(5)}
              </td>
              <td style={{ padding: '3px 8px', textAlign: 'center', color: 'var(--quiet)' }}>{row.cohort}</td>
              {row.d.map((v, i) => {
                const c = cell(v);
                const isActive = activeCell?.day === row.day && activeCell?.offset === i;
                const clickable = v !== null && onSelectCell;
                return (
                  <td
                    key={i}
                    title={`${row.day} 新增 ${row.cohort} 人，D${i} 留存 ${v === null ? '未到观测期' : `${(v * 100).toFixed(1)}%`}`}
                    onClick={() => clickable && onSelectCell?.(row.day, i)}
                    style={{
                      padding: '5px 0',
                      minWidth: 42,
                      textAlign: 'center',
                      background: c.bg,
                      color: c.fg,
                      borderRadius: 3,
                      fontVariantNumeric: 'tabular-nums',
                      cursor: clickable ? 'pointer' : 'default',
                      outline: isActive ? '2px solid var(--clay)' : 'none',
                      outlineOffset: -2,
                      transition: 'transform .1s',
                    }}
                  >
                    {c.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
