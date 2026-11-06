// ============================================================
// 展示层格式化工具
// 单独成文件，服务端组件和客户端组件都能 import（不能在 charts.tsx 里导出，
// 那是个 'use client' 模块，从服务端调用会直接报错）。
// ============================================================

export const SERIES_COLORS = [
  '#b3663f',
  '#6f7d5e',
  '#3a5578',
  '#e0a04a',
  '#8a6a86',
  '#a33b28',
  '#5c8a8a',
  '#918a7c',
];

export function fmtPct(v: number | null) {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

export function fmtNum(v: number) {
  return v.toLocaleString('zh-CN');
}

export function fmtDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}m${rest > 0 ? ` ${rest}s` : ''}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
