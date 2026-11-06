'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DrillDrawer, { type DrillRow } from '@/components/DrillDrawer';

// ============================================================
// 交互编排：
// - 选中某一天 → 全页模块联动高亮（不重新请求）
// - 点漏斗某一步 / 留存某格 → 拉钻取数据 → 开抽屉
// - 日期切换用 transition，旧数据变淡，不白屏
// ============================================================

export interface DrillTarget {
  kind: 'funnel' | 'retention';
  key: string;
  title: string;
  subtitle: string;
  /** 钻取必须带上页面当前的日期区间，否则会算出与图表不一致的数字 */
  from: string;
  to: string;
}

export interface DrillPayload {
  rows: DrillRow[];
  total: number;
  cohort?: number;
  retained?: number;
}

/** 跨模块共享的选中日 */
export function useSelectedDay() {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const toggle = (day: string) => setSelectedDay((d) => (d === day ? null : day));
  return { selectedDay, setSelectedDay, toggle };
}

/** 抽屉状态机 */
export function useDrill(actorLabel: string) {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const [payload, setPayload] = useState<DrillPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const open = async (t: DrillTarget) => {
    setTarget(t);
    setPayload(null);
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ kind: t.kind, key: t.key, from: t.from, to: t.to });
      const res = await fetch(`/api/dashboard/behavior/drill?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DrillPayload;
      startTransition(() => setPayload(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setTarget(null);
    setPayload(null);
    setError(null);
  };

  return { target, payload, loading, error, open, close, actorLabel };
}

/** 整页数据在切换日期时变淡，避免白屏 */
export function FadeOnNav({ children }: { children: React.ReactNode }) {
  const [pending] = useTransition();
  return (
    <div
      style={{
        opacity: pending ? 0.45 : 1,
        transition: 'opacity .18s',
        pointerEvents: pending ? 'none' : 'auto',
      }}
    >
      {children}
    </div>
  );
}

/** 抽屉容器：只有它需要 'use client'，图表本身已经是客户端组件 */
export function DrillHost({
  target,
  payload,
  loading,
  error,
  onClose,
  actorLabel,
}: {
  target: DrillTarget | null;
  payload: DrillPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  actorLabel: string;
}) {
  const subtitle = (
    <>
      {target?.subtitle}
      {loading && <div style={{ color: '#b0aa9d', marginTop: 4 }}>正在统计…</div>}
      {error && <div style={{ color: '#a33b28', marginTop: 4 }}>加载失败：{error}</div>}
      {payload && target?.kind === 'retention' && (
        <div style={{ marginTop: 4 }}>
          {payload.retained ?? 0}/{payload.cohort} 留存
        </div>
      )}
    </>
  );

  return (
    <DrillDrawer
      open={!!target}
      title={target?.title ?? ''}
      subtitle={subtitle}
      rows={payload?.rows ?? []}
      total={payload?.total ?? 0}
      actorLabel={actorLabel}
      onClose={onClose}
    />
  );
}

/** 跳转（保留 from/to） */
export function useRangeRouter() {
  const router = useRouter();
  return (path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    router.push(`${path}?${qs}`);
  };
}
