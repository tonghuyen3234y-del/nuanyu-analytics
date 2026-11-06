'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type {
  ActivityPoint,
  BehaviorOverview,
  FeatureUsage,
  FeatureTrendSeries,
  FunnelStep,
  RetentionMatrixRow,
  RetentionTrendPoint,
} from '@/lib/queries/behavior';
import {
  LineChart,
  GroupedBarChart,
  HBar,
  FunnelChart,
  RetentionMatrix,
} from '@/components/charts';
import { fmtPct, fmtNum as num, fmtDuration as duration } from '@/lib/format';
import {
  useSelectedDay,
  useDrill,
  DrillHost,
} from '@/components/behavior-interactions';
import { Empty } from '@/components/ui';

const FUNNEL_TITLES: Record<string, string> = {
  enter: '进入产品',
  session: '进入产品但没发消息',
  core: '发了消息但没发起 AI 执行',
  success: '发起了 AI 执行但没有成功完成',
  task: 'AI 正常返回但没有正常结束会话',
};

export function BehaviorBoard({
  from,
  to,
  actorLabel,
  hasIdentity,
  activeUsers,
  overview,
  prev,
  features,
  funnel,
  retention,
  activity,
  featureTrend,
}: {
  from: string;
  to: string;
  actorLabel: string;
  hasIdentity: boolean;
  activeUsers: number;
  overview: BehaviorOverview;
  prev: BehaviorOverview | null;
  features: FeatureUsage[];
  funnel: FunnelStep[];
  retention: { matrix: RetentionMatrixRow[]; trend: RetentionTrendPoint[] };
  activity: ActivityPoint[];
  featureTrend: FeatureTrendSeries[];
}) {
  const { selectedDay, setSelectedDay, toggle } = useSelectedDay();
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const drill = useDrill(actorLabel);

  const openFunnel = useCallback(
    (key: string) => {
      const step = funnel.find((f) => f.key === key);
      if (!step) return;
      drill.open({
        kind: 'funnel',
        key,
        title: `漏斗第 ${funnel.indexOf(step) + 1} 步：${step.label}`,
        subtitle: `${FUNNEL_TITLES[key] ?? ''}。这一层 ${step.users} 个${actorLabel}，比上一步少了 ${step.dropped} 个。`,
        from,
        to,
      });
    },
    [drill, funnel, actorLabel, from, to],
  );

  const openCell = useCallback(
    (day: string, offset: number) => {
      const cell = retention.matrix.find((m) => m.day === day)?.d[offset];
      drill.open({
        kind: 'retention',
        key: `${day}#${offset}`,
        title: `${day} 新增队列 · D${offset} 留存`,
        subtitle: `留存率 ${fmtPct(cell ?? null)}。下面是这批人里第 ${offset} 天还回来过的。`,
        from,
        to,
      });
    },
    [drill, retention.matrix, from, to],
  );

  return (
    <>

      {/* 核心指标卡（带环比） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <StatCard
          label={from === to ? 'DAU（日活跃）' : `${actorLabel}活跃数`}
          value={num(overview.active)}
          hint={from === to ? '当日有事件' : `去重${actorLabel}`}
          current={overview.active}
          previous={prev?.active ?? null}
        />
        <StatCard
          label="WAU（近 7 日活跃）"
          value={num(overview.wau)}
          hint="滚动 7 天"
          current={overview.wau}
          previous={prev?.wau ?? null}
        />
        <StatCard
          label="新增用户"
          value={num(overview.new_users)}
          hint={`回访 ${num(overview.returning_users)}`}
          current={overview.new_users}
          previous={prev?.new_users ?? null}
        />
        <StatCard
          label="人均使用时长"
          value={duration(overview.avg_duration_ms)}
          hint="完整会话均值"
          current={overview.avg_duration_ms ?? 0}
          previous={prev?.avg_duration_ms ?? null}
        />
        <StatCard
          label={`次日留存${hasIdentity ? '' : '（会话口径）'}`}
          value={fmtPct(overview.d1_rate)}
          hint={overview.d1_base === 0 ? '无队列' : `${overview.d1_retained}/${overview.d1_base}`}
          current={overview.d1_rate === null ? 0 : overview.d1_rate * 100}
          previous={prev?.d1_rate === null || prev?.d1_rate === undefined ? null : prev.d1_rate * 100}
          suffix="%"
          tone={overview.d1_rate !== null && overview.d1_rate < 0.2 ? 'bad' : 'plain'}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))',
          gap: 12,
          marginBottom: 22,
        }}
      >
        <StatCard
          label="7 日留存率"
          value={fmtPct(overview.d7_rate)}
          hint={overview.d7_base === 0 ? '队列未满 7 天' : `${overview.d7_retained}/${overview.d7_base}`}
          current={overview.d7_rate === null ? 0 : overview.d7_rate * 100}
          previous={prev?.d7_rate === null || prev?.d7_rate === undefined ? null : prev.d7_rate * 100}
          suffix="%"
        />
        <StatCard
          label="会话数"
          value={num(overview.sessions)}
          hint={`人均 ${overview.avg_sessions_per_user?.toFixed(2) ?? '—'}`}
          current={overview.sessions}
          previous={prev?.sessions ?? null}
        />
        <StatCard
          label="行为事件数"
          value={num(overview.actions)}
          hint={`人均 ${overview.avg_actions_per_user?.toFixed(1) ?? '—'}`}
          current={overview.actions}
          previous={prev?.actions ?? null}
        />
        <StatCard
          label="累计使用时长"
          value={duration(overview.total_duration_ms)}
          hint="完整会话"
          current={overview.total_duration_ms}
          previous={prev?.total_duration_ms ?? null}
        />
      </div>

      {/* ===== 功能使用 ===== */}
      <SectionTitle title="功能使用分析" />
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 12, marginBottom: 22 }}>
        <section className="card" style={{ padding: 16, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>功能</th>
                <th style={{ textAlign: 'right' }}>点击次数</th>
                <th style={{ textAlign: 'right' }}>使用人数</th>
                <th style={{ textAlign: 'right' }}>次/人</th>
                <th style={{ textAlign: 'right' }}>占比</th>
                <th style={{ textAlign: 'right' }}>触达率</th>
              </tr>
            </thead>
            <tbody>
              {features.map((u) => {
                const isSel = selectedFeature === u.event_name;
                return (
                  <tr
                    key={u.event_name}
                    onClick={() => setSelectedFeature(isSel ? null : u.event_name)}
                    style={{
                      cursor: 'pointer',
                      background: isSel ? '#f6f1ea' : undefined,
                    }}
                  >
                    <td>
                      <div style={{ fontSize: 13 }}>{u.label}</div>
                      <div className="mono" style={{ color: '#b0aa9d', fontSize: 11 }}>
                        {u.event_name}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: u.clicks > 0 ? 600 : 400 }}>{num(u.clicks)}</td>
                    <td style={{ textAlign: 'right' }}>{num(u.users)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--quiet)' }}>
                      {u.frequency === null ? '—' : u.frequency.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--quiet)' }}>{fmtPct(u.share)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--quiet)' }}>{fmtPct(u.reach)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 12px' }}>使用占比</h3>
          {features.every((u) => u.clicks === 0) ? (
            <Empty text="暂无数据" />
          ) : (
            <HBar
              rows={features
                .filter((u) => u.clicks > 0)
                .sort((a, b) => b.clicks - a.clicks)
                .map((u) => ({
                  label: u.label,
                  key: u.event_name,
                  value: u.clicks,
                  share: u.share ?? 0,
                  title: `${u.event_name}：${u.clicks} 次 / ${u.users} 人`,
                }))}
              formatValue={(v) => String(v)}
              selected={selectedFeature}
              onSelect={(k) => setSelectedFeature(selectedFeature === k ? null : k)}
            />
          )}
        </section>
      </div>

      {/* ===== 漏斗 ===== */}
      <div id="funnel" />
      <SectionTitle title="用户行为漏斗" />
      <section className="card" style={{ padding: 16, marginBottom: 22 }}>
        {funnel[0].users === 0 ? (
          <Empty text="区间内没有 session_start" />
        ) : (
          <>
            <FunnelChart steps={funnel} onSelect={openFunnel} activeKey={drill.target?.key ?? null} />
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid #f0ece4',
                fontSize: 12,
                color: 'var(--quiet)',
              }}
            >
              整体转化{' '}
              <b style={{ color: 'var(--ink)' }}>{fmtPct(funnel[funnel.length - 1].total_rate)}</b>
              <span style={{ marginLeft: 8 }}>
                {funnel[funnel.length - 1].users} / {funnel[0].users}
              </span>
            </div>
          </>
        )}
      </section>

      {/* ===== 留存 ===== */}
      <div id="retention" />
      <SectionTitle title="用户留存分析" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>留存趋势</h3>
          {retention.trend.length === 0 ? (
            <Empty text="区间内没有新增用户" />
          ) : (
            <LineChart
              height={170}
              yMax={1}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              showArea
              activeDay={selectedDay}
              onSelectDay={toggle}
              series={[
                {
                  name: 'd1',
                  label: '次日留存',
                  color: '#b3663f',
                  points: retention.trend.map((t) => ({ day: t.day.slice(5), value: t.d1 ?? 0 })),
                },
              ]}
            />
          )}
        </section>

        <section className="card" style={{ padding: 16, overflow: 'auto' }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>留存矩阵</h3>
          {retention.matrix.length === 0 ? (
            <Empty text="区间内没有新增用户" />
          ) : (
            <RetentionMatrix
              rows={retention.matrix}
              maxOffset={7}
              onSelectCell={openCell}
              activeCell={
                drill.target?.kind === 'retention'
                  ? {
                      day: drill.target.key.split('#')[0],
                      offset: Number(drill.target.key.split('#')[1]),
                    }
                  : null
              }
            />
          )}
        </section>
      </div>

      {/* ===== 趋势 ===== */}
      <SectionTitle title="用户行为趋势" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>活跃趋势</h3>
          {activity.length === 0 ? (
            <Empty text="暂无数据" />
          ) : (
            <LineChart
              height={190}
              activeDay={selectedDay}
              onSelectDay={toggle}
              series={[
                {
                  name: 'active',
                  label: `活跃${actorLabel}`,
                  points: activity.map((a) => ({ day: a.day.slice(5), value: a.active })),
                },
                {
                  name: 'new',
                  label: `新增${actorLabel}`,
                  points: activity.map((a) => ({ day: a.day.slice(5), value: a.new_users })),
                },
                {
                  name: 'sessions',
                  label: '会话数',
                  points: activity.map((a) => ({ day: a.day.slice(5), value: a.sessions })),
                },
              ]}
            />
          )}
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>消息与 AI 执行</h3>
          {activity.length === 0 ? (
            <Empty text="暂无数据" />
          ) : (
            <GroupedBarChart
              height={190}
              onSelectDay={toggle}
              data={activity.map((a) => ({ day: a.day.slice(5), values: [a.messages, a.runs] }))}
              series={[
                { label: '消息数', color: '#b3663f' },
                { label: 'AI 执行次数', color: '#6f7d5e' },
              ]}
            />
          )}
        </section>
      </div>

      <section className="card" style={{ padding: 16, marginBottom: 22 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>功能使用变化</h3>
        {activity.length === 0 ? (
          <Empty text="暂无数据" />
        ) : (
          <LineChart
            height={200}
            activeDay={selectedDay}
            onSelectDay={toggle}
            series={featureTrend.map((s) => ({
              ...s,
              points: s.points.map((p) => ({ day: p.day, value: p.value })),
            }))}
          />
        )}
      </section>

      <DrillHost
        target={drill.target}
        payload={drill.payload}
        loading={drill.loading}
        error={drill.error}
        actorLabel={actorLabel}
        onClose={drill.close}
      />

      {selectedDay && (
        <div style={{ fontSize: 11.5, color: '#b0aa9d' }}>
          已锁定 <b style={{ color: 'var(--clay)' }}>{selectedDay}</b>
          <button
            type="button"
            onClick={() => setSelectedDay(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--clay)',
              cursor: 'pointer',
              padding: '0 4px',
              font: 'inherit',
              textDecoration: 'underline',
            }}
          >
            取消
          </button>
        </div>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
  current,
  previous,
  suffix = '',
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  current: number;
  previous: number | null;
  suffix?: string;
  tone?: 'plain' | 'bad';
}) {
  // 环比：上一周期为 0 或不存在时不给百分比，避免编造
  let delta: { text: string; up: boolean } | null = null;
  if (previous !== null && previous !== 0 && current !== previous) {
    const pct = ((current - previous) / previous) * 100;
    delta = { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}${suffix || '%'}`, up: pct > 0 };
  } else if (previous === 0 && current > 0) {
    delta = { text: '新增于上期', up: true };
  }

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 12.5, color: 'var(--quiet)', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          lineHeight: 1.2,
          color: tone === 'bad' ? '#a33b28' : 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, minHeight: 16 }}>
        {delta && (
          <span
            style={{
              fontSize: 11,
              color: delta.up ? '#456135' : '#a33b28',
              background: delta.up ? '#eef4ea' : '#fbe9e6',
              borderRadius: 3,
              padding: '0 4px',
            }}
          >
            {delta.up ? '↑' : '↓'} {delta.text}
          </span>
        )}
        {hint && <span style={{ fontSize: 11.5, color: '#a09a8d' }}>{hint}</span>}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>{title}</h2>;
}
