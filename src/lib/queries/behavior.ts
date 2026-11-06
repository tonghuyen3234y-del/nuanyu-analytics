import { query } from '@/lib/db';

// ============================================================
// 用户行为分析查询层
//
// 口径总则（与「埋点自检」「概览」一致）：
// 1. 全部指标直查 analytics.event_logs / agent_runs，不做任何模拟或估算。
// 2. 时间一律先转 Asia/Shanghai 再取日期，避免 UTC 跨天错位。
// 3. 「用户」口径（见 getIdentityCoverage）：
//    - user_id_hash 现则用 user_id_hash（登录用户，可跨设备）
//    - 否则用 session_id（未登录，一次性）
//    当前埋点尚未上报名 user_id_hash，所以指标按会话口径计算，
//    页面顶部会明确标注，不假装是 DAU。
// ============================================================

/** 会话口径的用户表达式：优先摘要用户标识，缺失时退化为 session_id */
const ACTOR_SQL = `COALESCE(NULLIF(e.properties->>'user_id_hash',''), e.session_id)`;

export interface BehaviorRange {
  /** 起始日（含），YYYY-MM-DD */
  from: string;
  /** 结束日（含），YYYY-MM-DD */
  to: string;
}

// ------------------------------------------------------------
// 0. 用户标识覆盖度：没有它，DAU/WAU/留存只能按会话算
// ------------------------------------------------------------
export interface IdentityCoverage {
  total_events: number;
  with_user_hash: number;
  with_anonymous_id: number;
  users: number;
  sessions: number;
}

export async function getIdentityCoverage(r: BehaviorRange): Promise<IdentityCoverage> {
  const rows = await query<Record<string, string>>(
    `SELECT count(*)::text AS total_events,
            count(*) FILTER (WHERE properties ? 'user_id_hash')::text AS with_user_hash,
            count(*) FILTER (WHERE properties ? 'anonymous_id')::text AS with_anonymous_id,
            count(DISTINCT NULLIF(properties->>'user_id_hash',''))::text AS users,
            count(DISTINCT session_id)::text AS sessions
       FROM analytics.event_logs
      WHERE occurred_at >= $1::date
        AND occurred_at < $2::date + 1`,
    [r.from, r.to],
  );
  const d = rows[0] ?? {};
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    total_events: n('total_events'),
    with_user_hash: n('with_user_hash'),
    with_anonymous_id: n('with_anonymous_id'),
    users: n('users'),
    sessions: n('sessions'),
  };
}

// ------------------------------------------------------------
// 1. 核心概览
// ------------------------------------------------------------
export interface BehaviorOverview {
  /** 统计区间内的去重用户数（当前会话口径） */
  active: number;
  /** 区间内最近 7 天去重用户数 → WAU 口径 */
  wau: number;
  /** 统计区间内首次出现的用户数 */
  new_users: number;
  returning_users: number;
  /** 人均时长 / 人均会话数 */
  avg_duration_ms: number | null;
  total_duration_ms: number;
  avg_sessions_per_user: number | null;
  avg_actions_per_user: number | null;
  /** 次日留存（窗口期口径，见下方 SQL 注释） */
  d1_rate: number | null;
  d1_base: number;
  d1_retained: number;
  d7_rate: number | null;
  d7_base: number;
  d7_retained: number;
  sessions: number;
  actions: number;
}

export async function getBehaviorOverview(r: BehaviorRange): Promise<BehaviorOverview> {
  const rows = await query<Record<string, string | null>>(
    // 注意：pg 按 SQL 中首次出现的占位符顺序绑参，
    // 因此所有查询必须让 $1 先于 $2 出现，否则参数会错位。
    `WITH win AS (
       SELECT ($1::date - GREATEST(($2::date - $1::date) - 1, 0)) AS start_day,
              $1::date AS from_day,
              $2::date AS to_day
     ),
     ev AS (
       SELECT ${ACTOR_SQL} AS actor,
              session_id,
              event_name,
              occurred_at,
              (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS day_of
         FROM analytics.event_logs e
        WHERE occurred_at >= (SELECT start_day FROM win)
          AND occurred_at < $2::date + 1
     ),
     in_range AS (
       SELECT * FROM ev WHERE day_of BETWEEN $1::date AND $2::date
     ),
     -- 首次出现日期取全量历史，不只看窗口，否则「新用户」会被算错
     first_seen AS (
       SELECT ${ACTOR_SQL} AS actor,
              min((occurred_at AT TIME ZONE 'Asia/Shanghai')::date) AS first_day
         FROM analytics.event_logs e
        WHERE occurred_at < $2::date + 1
        GROUP BY 1
     ),
     cohort AS (
       SELECT DISTINCT i.actor, f.first_day
         FROM in_range i JOIN first_seen f ON f.actor = i.actor
        WHERE f.first_day BETWEEN $1::date AND $2::date
     ),
     -- 会话时长 = session_end - session_start。
     -- 没有 session_end 的会话不计入，避免把「页面一直开着」算成超长时长
     session_span AS (
       SELECT session_id,
              extract(epoch FROM (max(t) FILTER (WHERE event_name = 'session_end')
                                - min(t) FILTER (WHERE event_name = 'session_start'))) * 1000 AS ms
         FROM (SELECT session_id, event_name, occurred_at AS t
                 FROM analytics.event_logs e
                WHERE occurred_at >= (SELECT start_day FROM win)
                  AND occurred_at < $2::date + 1) s
        GROUP BY session_id
     )
     SELECT
       (SELECT count(DISTINCT actor) FROM in_range)::text AS active,
       (SELECT count(DISTINCT actor) FROM ev
         WHERE day_of BETWEEN GREATEST($1::date, $2::date - 6) AND $2::date)::text AS wau,
       (SELECT count(*) FROM cohort)::text AS new_users,
       (SELECT count(DISTINCT actor) FROM in_range
         WHERE actor NOT IN (SELECT actor FROM cohort))::text AS returning_users,
       (SELECT avg(ms) FROM session_span
         WHERE ms IS NOT NULL AND ms BETWEEN 0 AND 86400000)::text AS avg_duration_ms,
       (SELECT coalesce(sum(ms), 0) FROM session_span
         WHERE ms IS NOT NULL AND ms BETWEEN 0 AND 86400000)::text AS total_duration_ms,
       (SELECT count(DISTINCT session_id) FROM in_range)::text AS sessions,
       (SELECT count(*) FROM in_range)::text AS actions,
       -- 次日留存：分母只算「D+1 仍在观测期内」的用户
       (SELECT count(*) FROM cohort WHERE first_day + 1 <= $2::date)::text AS d1_base,
       (SELECT count(*) FROM cohort c WHERE c.first_day + 1 <= $2::date
          AND EXISTS (SELECT 1 FROM in_range j
                       WHERE j.actor = c.actor AND j.day_of = c.first_day + 1))::text AS d1_retained,
       -- 7 日留存：D+7 仍须在观测期内，否则不进分母
       (SELECT count(*) FROM cohort WHERE first_day + 7 <= $2::date)::text AS d7_base,
       (SELECT count(*) FROM cohort c WHERE c.first_day + 7 <= $2::date
          AND EXISTS (SELECT 1 FROM in_range j
                       WHERE j.actor = c.actor AND j.day_of = c.first_day + 7))::text AS d7_retained`,
    [r.from, r.to],
  );

  const d = rows[0] ?? {};
  const n = (k: string) => Number(d[k] ?? 0);
  const nul = (k: string) => (d[k] === null || d[k] === undefined ? null : Number(d[k]));

  const sessions = n('sessions');
  const active = n('active');
  const d1Base = n('d1_base');
  const d7Base = n('d7_base');

  return {
    active,
    wau: n('wau'),
    new_users: n('new_users'),
    returning_users: n('returning_users'),
    avg_duration_ms: nul('avg_duration_ms'),
    total_duration_ms: n('total_duration_ms'),
    avg_sessions_per_user: active > 0 ? sessions / active : null,
    avg_actions_per_user: active > 0 ? n('actions') / active : null,
    d1_base: d1Base,
    d1_retained: n('d1_retained'),
    d1_rate: d1Base > 0 ? n('d1_retained') / d1Base : null,
    d7_base: d7Base,
    d7_retained: n('d7_retained'),
    d7_rate: d7Base > 0 ? n('d7_retained') / d7Base : null,
    sessions,
    actions: n('actions'),
  };
}

// ------------------------------------------------------------
// 2. 功能使用分析
//    功能 = 埋点事件。文档 03 一共 8 个事件，这里全部呈现，
//    使用人数按会话口径（actor）去重。
// ------------------------------------------------------------
export interface FeatureUsage {
  event_name: string;
  label: string;
  category: '入口' | '交互' | 'AI 执行' | '反馈' | '退出';
  clicks: number;
  users: number;
  /** 使用频率 = 次数 ÷ 使用人数 */
  frequency: number | null;
  /** 使用占比 = 次数 ÷ 全部事件次数 */
  share: number | null;
  /** 触达率 = 使用人数 ÷ 活跃用户数 */
  reach: number | null;
}

const EVENT_LABEL: Record<string, { label: string; category: FeatureUsage['category'] }> = {
  session_start: { label: '进入会话', category: '入口' },
  message_send: { label: '发送消息', category: '交互' },
  agent_request_start: { label: 'AI 开始执行', category: 'AI 执行' },
  agent_response: { label: 'AI 正常返回', category: 'AI 执行' },
  agent_error: { label: 'AI 执行失败', category: 'AI 执行' },
  feedback_submit: { label: '提交反馈', category: '反馈' },
  retry_click: { label: '点击重试', category: '反馈' },
  session_end: { label: '退出会话', category: '退出' },
};

const EVENT_ORDER = [
  'session_start',
  'message_send',
  'agent_request_start',
  'agent_response',
  'agent_error',
  'retry_click',
  'feedback_submit',
  'session_end',
];

export async function getFeatureUsage(
  r: BehaviorRange,
  activeUsers: number,
): Promise<FeatureUsage[]> {
  const rows = await query<Record<string, string>>(
    `SELECT event_name,
            count(*)::text AS clicks,
            count(DISTINCT ${ACTOR_SQL})::text AS users
       FROM analytics.event_logs e
      WHERE occurred_at >= $1::date
        AND occurred_at < $2::date + 1
      GROUP BY 1`,
    [r.from, r.to],
  );

  const byName = new Map(rows.map((x) => [x.event_name, x]));
  const total = rows.reduce((a, x) => a + Number(x.clicks), 0);

  return EVENT_ORDER.map((name) => {
    const x = byName.get(name);
    const clicks = Number(x?.clicks ?? 0);
    const users = Number(x?.users ?? 0);
    const meta = EVENT_LABEL[name] ?? { label: name, category: '交互' as const };
    return {
      event_name: name,
      label: meta.label,
      category: meta.category,
      clicks,
      users,
      frequency: users > 0 ? clicks / users : null,
      share: total > 0 && clicks > 0 ? clicks / total : null,
      reach: activeUsers > 0 ? users / activeUsers : null,
    };
  });
}

// ------------------------------------------------------------
// 3. 行为漏斗
//    五步全部基于真实事件，且每一步都要求是「同一批用户」继续下去。
// ------------------------------------------------------------
export interface FunnelStep {
  key: string;
  label: string;
  hint: string;
  users: number;
  /** 相对上一步的转化率 */
  step_rate: number | null;
  /** 相对第一步的整体转化率 */
  total_rate: number | null;
  /** 相对上一步的流失人数 */
  dropped: number;
  drop_rate: number | null;
}

export async function getFunnel(r: BehaviorRange): Promise<FunnelStep[]> {
  const rows = await query<Record<string, string>>(
    `WITH ev AS (
       SELECT ${ACTOR_SQL} AS actor,
              session_id,
              message_id,
              request_id,
              event_name,
              occurred_at
         FROM analytics.event_logs e
        WHERE occurred_at >= $1::date
          AND occurred_at < $2::date + 1
     ),
     s1 AS (SELECT DISTINCT actor FROM ev WHERE event_name = 'session_start'),
     s2 AS (SELECT DISTINCT actor FROM ev WHERE event_name = 'session_start'
              AND session_id IN (SELECT session_id FROM ev WHERE event_name = 'message_send')),
     s3 AS (SELECT DISTINCT e.actor FROM ev e
             WHERE e.event_name = 'agent_request_start'
               AND e.session_id IN (SELECT session_id FROM ev WHERE event_name = 'message_send')),
     s4 AS (SELECT DISTINCT e.actor FROM ev e
              JOIN analytics.agent_runs r ON r.request_id = e.request_id
             WHERE e.event_name = 'agent_request_start' AND r.status = 'success'),
     s5 AS (SELECT DISTINCT e.actor FROM ev e
             WHERE e.event_name = 'session_end'
               AND e.session_id IN (SELECT session_id FROM ev WHERE event_name = 'agent_response'))
     SELECT (SELECT count(*) FROM s1)::text AS s1,
            (SELECT count(*) FROM s2)::text AS s2,
            (SELECT count(*) FROM s3)::text AS s3,
            (SELECT count(*) FROM s4)::text AS s4,
            (SELECT count(*) FROM s5)::text AS s5`,
    [r.from, r.to],
  );

  const d = rows[0] ?? {};
  const counts = [Number(d.s1 ?? 0), Number(d.s2 ?? 0), Number(d.s3 ?? 0), Number(d.s4 ?? 0), Number(d.s5 ?? 0)];
  const first = counts[0];

  const defs = [
    { key: 'enter', label: '进入产品', hint: 'E01 session_start 去重用户' },
    { key: 'session', label: '开始会话并发送首条消息', hint: 'E02 message_send 且有 E01' },
    { key: 'core', label: '使用核心功能（发起 AI 执行）', hint: 'E03 agent_request_start' },
    { key: 'success', label: '核心功能正常完成', hint: '对应 agent_runs.status = success' },
    { key: 'task', label: '完成任务并正常结束会话', hint: 'E08 session_end 且会话内有 AI 回答' },
  ];

  return defs.map((def, i) => {
    const users = counts[i];
    const prev = i === 0 ? null : counts[i - 1];
    return {
      ...def,
      users,
      step_rate: prev === null ? null : prev > 0 ? users / prev : null,
      total_rate: first > 0 ? users / first : null,
      dropped: prev === null ? 0 : Math.max(0, prev - users),
      drop_rate: prev === null ? null : prev > 0 ? Math.max(0, prev - users) / prev : null,
    };
  });
}

// ------------------------------------------------------------
// 4. 留存分析
// ------------------------------------------------------------
export interface RetentionMatrixRow {
  day: string;
  cohort: number;
  /** d[n] = 第 n 日留存率，null 表示窗口尚未到达 */
  d: (number | null)[];
}

export interface RetentionTrendPoint {
  day: string;
  d1: number | null;
  d7: number | null;
}

export async function getRetention(r: BehaviorRange, maxOffset = 7) {
  // first_seen 里引用 $1 只为保证占位符顺序（见 getBehaviorOverview 注释）
  const firstSeen = `
    first_seen AS (
      SELECT actor, min(d) AS first_day FROM (
        SELECT ${ACTOR_SQL} AS actor,
               (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
          FROM analytics.event_logs e
         WHERE occurred_at >= $1::date - 3650 AND occurred_at < $2::date + 1
      ) x GROUP BY 1
    )`;

  const matrix = await query<Record<string, string>>(
    `WITH ${firstSeen},
     daily AS (
       SELECT DISTINCT ${ACTOR_SQL} AS actor,
              (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
         FROM analytics.event_logs e
        WHERE occurred_at >= $1::date AND occurred_at < $2::date + 1
     ),
     cohort AS (
       SELECT DISTINCT actor, first_day FROM first_seen
        WHERE first_day BETWEEN $1::date AND $2::date
     ),
     cohort_size AS (SELECT first_day, count(*)::text AS cohort FROM cohort GROUP BY 1)
     SELECT to_char(cs.first_day,'YYYY-MM-DD') AS day,
            cs.cohort,
            (($2::date - cs.first_day))::text AS observable,
            ${Array.from(
              { length: maxOffset + 1 },
              (_, i) =>
                `(SELECT count(DISTINCT dy.actor) FROM daily dy
                   JOIN cohort c ON c.actor = dy.actor
                  WHERE c.first_day = cs.first_day AND dy.d = cs.first_day + ${i})::text AS d${i}`,
            ).join(',\n            ')}
       FROM cohort_size cs ORDER BY cs.first_day`,
    [r.from, r.to],
  );

  const matrixRows: RetentionMatrixRow[] = matrix.map((x) => {
    const cohort = Number(x.cohort ?? 0);
    const observable = Number(x.observable ?? 0);
    return {
      day: String(x.day),
      cohort,
      d: Array.from({ length: maxOffset + 1 }, (_, i) => {
        // 观测窗口未到的天数留空，绝不按 0 画
        if (i > observable) return null;
        if (cohort === 0) return null;
        return Number(x[`d${i}`] ?? 0) / cohort;
      }),
    };
  });

  // 趋势：以「当日新增」为队列，逐日给出 D1 / D7
  const trendRows = await query<Record<string, string>>(
    `WITH ${firstSeen},
     daily AS (
       SELECT DISTINCT ${ACTOR_SQL} AS actor,
              (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
         FROM analytics.event_logs e
        WHERE occurred_at >= $1::date AND occurred_at < $2::date + 1
     ),
     cohort AS (
       SELECT DISTINCT actor, first_day FROM first_seen
        WHERE first_day BETWEEN $1::date AND $2::date
     )
     SELECT to_char(c.first_day,'YYYY-MM-DD') AS day,
            count(*)::text AS cohort,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM daily d WHERE d.actor = c.actor AND d.d = c.first_day + 1
            ))::text AS d1_users,
            count(*) FILTER (WHERE c.first_day + 7 <= $2::date)::text AS d7_base,
            count(*) FILTER (WHERE c.first_day + 7 <= $2::date AND EXISTS (
              SELECT 1 FROM daily d WHERE d.actor = c.actor AND d.d = c.first_day + 7
            ))::text AS d7_users
       FROM cohort c GROUP BY 1 ORDER BY 1`,
    [r.from, r.to],
  );

  const trend: RetentionTrendPoint[] = trendRows.map((x) => {
    const cohort = Number(x.cohort ?? 0);
    const d7base = Number(x.d7_base ?? 0);
    return {
      day: String(x.day),
      d1: cohort > 0 ? Number(x.d1_users ?? 0) / cohort : null,
      d7: d7base > 0 ? Number(x.d7_users ?? 0) / d7base : null,
    };
  });

  return { matrix: matrixRows, trend };
}

// ------------------------------------------------------------
// 5. 趋势（按天活跃 + 功能使用）
// ------------------------------------------------------------
export interface ActivityPoint {
  day: string;
  active: number;
  new_users: number;
  sessions: number;
  messages: number;
  runs: number;
}

export async function getActivityTrend(r: BehaviorRange): Promise<ActivityPoint[]> {
  const rows = await query<Record<string, string>>(
    `WITH grid AS (
       SELECT generate_series($1::date, $2::date, '1 day')::date AS gday
     ),
     ev AS (
       SELECT ${ACTOR_SQL} AS actor,
              session_id,
              message_id,
              request_id,
              event_name,
              (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
         FROM analytics.event_logs e
        WHERE occurred_at >= $1::date AND occurred_at < $2::date + 1
     ),
     first_day AS (
       SELECT ${ACTOR_SQL} AS actor,
              min((occurred_at AT TIME ZONE 'Asia/Shanghai')::date) AS d
         FROM analytics.event_logs e
        WHERE occurred_at >= $1::date - 3650 AND occurred_at < $2::date + 1
        GROUP BY 1
     )
     SELECT to_char(g.gday,'YYYY-MM-DD') AS day,
            (SELECT count(DISTINCT ev.actor) FROM ev WHERE ev.d = g.gday)::text AS active,
            (SELECT count(DISTINCT ev.actor) FROM ev
               JOIN first_day f ON f.actor = ev.actor
              WHERE ev.d = g.gday AND f.d = g.gday)::text AS new_users,
            (SELECT count(DISTINCT ev.session_id) FROM ev WHERE ev.d = g.gday)::text AS sessions,
            (SELECT count(DISTINCT ev.message_id) FROM ev
              WHERE ev.d = g.gday AND ev.event_name = 'message_send')::text AS messages,
            (SELECT count(DISTINCT ev.request_id) FROM ev
              WHERE ev.d = g.gday AND ev.event_name = 'agent_request_start')::text AS runs
       FROM grid g ORDER BY g.gday`,
    [r.from, r.to],
  );
  return rows.map((x) => ({
    day: x.day,
    active: Number(x.active ?? 0),
    new_users: Number(x.new_users ?? 0),
    sessions: Number(x.sessions ?? 0),
    messages: Number(x.messages ?? 0),
    runs: Number(x.runs ?? 0),
  }));
}

export interface FeatureTrendSeries {
  name: string;
  label: string;
  points: { day: string; value: number }[];
}

/** 主要功能按天的使用次数，用于多线折线图 */
export async function getFeatureTrend(r: BehaviorRange): Promise<FeatureTrendSeries[]> {
  const names = EVENT_ORDER.filter((n) => n !== 'agent_response' && n !== 'agent_error');
  const rows = await query<Record<string, string>>(
    `WITH grid AS (
       SELECT generate_series($1::date, $2::date, '1 day')::date AS gday
     ),
     ev AS (
       SELECT event_name, (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
         FROM analytics.event_logs
        WHERE occurred_at >= $1::date AND occurred_at < $2::date + 1
     )
     SELECT to_char(g.gday,'MM-DD') AS day,
            ${names.map((n) => `(SELECT count(*) FROM ev e WHERE e.d = g.gday AND e.event_name = '${n}')::text AS ${n}`).join(',\n            ')}
       FROM grid g ORDER BY g.gday`,
    [r.from, r.to],
  );

  return names.map((name) => ({
    name,
    label: EVENT_LABEL[name]?.label ?? name,
    points: rows.map((x) => ({ day: x.day, value: Number(x[name] ?? 0) })),
  }));
}

// ------------------------------------------------------------
// 6. 数据范围：给自定义日期选择器提供可选区间
// ------------------------------------------------------------
export async function getDataRange() {
  const rows = await query<{ first: string | null; last: string | null }>(
    `SELECT to_char(min(occurred_at) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS first,
            to_char(max(occurred_at) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS last
       FROM analytics.event_logs`,
  );
  return { first: rows[0]?.first ?? null, last: rows[0]?.last ?? null };
}

// ------------------------------------------------------------
// 7. 钻取：漏斗某一步流失的具体对象
// ------------------------------------------------------------
export interface DrilldownRow {
  actor: string;
  session_id: string;
  /** 该对象走到的最远一步 */
  last_event: string;
  /** 最后一条事件时间 */
  last_at: string;
  /** 该对象在区间内的事件数 */
  events: number;
}

const FUNNEL_ORDER = [
  'session_start',
  'message_send',
  'agent_request_start',
  'agent_response',
  'session_end',
];

/**
 * 返回「到达了第 stepKey 步、但没有到达下一步」的对象清单。
 * 用事件到达判定，与漏斗图完全同源，不会出现图说 209 人、抽屉里只有 100 人的情况。
 */
export async function getFunnelDropOff(
  r: BehaviorRange,
  stepKey: FunnelStep['key'],
  limit = 30,
): Promise<{ rows: DrilldownRow[]; total: number }> {
  const stepIndex: Record<FunnelStep['key'], number> = {
    enter: 0,
    session: 1,
    core: 2,
    success: 3,
    task: 4,
  };
  const reached = stepIndex[stepKey];
  const next = reached + 1;

  // 每一步的判定条件（与 getFunnel 保持一致）
  const conditions = [
    `e.event_name = 'session_start'`,
    `e.event_name = 'message_send'`,
    `e.event_name = 'agent_request_start'`,
    `e.event_name = 'agent_request_start'
       AND EXISTS (SELECT 1 FROM analytics.agent_runs ar
                    WHERE ar.request_id = e.request_id AND ar.status = 'success')`,
    `e.event_name = 'session_end'
       AND EXISTS (SELECT 1 FROM analytics.event_logs x
                    WHERE x.session_id = e.session_id AND x.event_name = 'agent_response')`,
  ];

  const hasNext = next < conditions.length;
  const body = `
    WITH ev AS (
      SELECT ${ACTOR_SQL} AS actor,
             session_id,
             request_id,
             event_name,
             occurred_at
        FROM analytics.event_logs e
       WHERE occurred_at >= $1::date AND occurred_at < $2::date + 1
    ),
    reached AS (SELECT DISTINCT e.actor FROM ev e WHERE ${conditions[reached]}),
    ${hasNext ? `nextset AS (SELECT DISTINCT e.actor FROM ev e WHERE ${conditions[next]}),` : ''}
    target AS (
      SELECT r.actor FROM reached r
      ${hasNext ? 'WHERE r.actor NOT IN (SELECT actor FROM nextset)' : ''}
    ),
    stat AS (
      SELECT e.actor,
             min(e.session_id) AS session_id,
             count(*)::text AS events,
             max(e.occurred_at) AS last_ts
        FROM ev e JOIN target t ON t.actor = e.actor
       GROUP BY e.actor
    )
    SELECT stat.actor,
           stat.session_id,
           stat.events,
           to_char(stat.last_ts AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') AS last_at,
           (SELECT e2.event_name FROM ev e2
             WHERE e2.actor = stat.actor
             ORDER BY e2.occurred_at DESC LIMIT 1) AS last_event
      FROM stat
     ORDER BY stat.last_ts DESC
     LIMIT $3`;

  const rows = await query<DrilldownRow>(body, [r.from, r.to, String(limit)]);
  const countRow = await query<{ count: string }>(
    `WITH ev AS (
       SELECT ${ACTOR_SQL} AS actor,
              session_id,
              request_id,
              event_name
         FROM analytics.event_logs e
        WHERE occurred_at >= $1::date AND occurred_at < $2::date + 1
     ),
     reached AS (SELECT DISTINCT e.actor FROM ev e WHERE ${conditions[reached]})
     ${hasNext ? `, nextset AS (SELECT DISTINCT e.actor FROM ev e WHERE ${conditions[next]})` : ''}
     SELECT count(*)::text AS count FROM reached r
     ${hasNext ? 'WHERE r.actor NOT IN (SELECT actor FROM nextset)' : ''}`,
    [r.from, r.to],
  );

  return { rows, total: Number(countRow[0]?.count ?? 0) };
}

// ------------------------------------------------------------
// 8. 钻取：留存矩阵某一格的具体对象
// ------------------------------------------------------------
export async function getRetentionCohort(
  cohortDay: string,
  offset: number,
  limit = 30,
): Promise<{ rows: DrilldownRow[]; cohort: number; retained: number }> {
  const rows = await query<DrilldownRow>(
    `WITH first_seen AS (
       SELECT actor, min(d) AS first_day FROM (
         SELECT ${ACTOR_SQL} AS actor,
                (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
           FROM analytics.event_logs e
          WHERE occurred_at >= $1::date - 3650 AND occurred_at < $1::date + 1
       ) x GROUP BY 1
     ),
     cohort AS (
       SELECT actor FROM first_seen WHERE first_day = $1::date
     ),
     hit AS (
       SELECT DISTINCT ${ACTOR_SQL} AS actor
         FROM analytics.event_logs e
        WHERE (occurred_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date + $2::int
          AND occurred_at < $1::date + $2::int + 1
     )
     SELECT c.actor,
            (SELECT min(e.session_id) FROM analytics.event_logs e
              WHERE ${ACTOR_SQL} = c.actor) AS session_id,
            (SELECT e.event_name FROM analytics.event_logs e
              WHERE ${ACTOR_SQL} = c.actor AND (e.occurred_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date + $2::int
              ORDER BY e.occurred_at DESC LIMIT 1) AS last_event,
            to_char((SELECT max(e.occurred_at) FROM analytics.event_logs e
                      WHERE ${ACTOR_SQL} = c.actor) AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') AS last_at,
            (SELECT count(*)::text FROM analytics.event_logs e
              WHERE ${ACTOR_SQL} = c.actor) AS events
       FROM cohort c
      JOIN hit h ON h.actor = c.actor
      ORDER BY c.actor
      LIMIT $3`,
    [cohortDay, String(offset), String(limit)],
  );

  const stat = await query<{ cohort: string; retained: string }>(
    `WITH first_seen AS (
       SELECT actor, min(d) AS first_day FROM (
         SELECT ${ACTOR_SQL} AS actor,
                (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS d
           FROM analytics.event_logs e
          WHERE occurred_at >= $1::date - 3650 AND occurred_at < $1::date + 1
       ) x GROUP BY 1
     )
     SELECT (SELECT count(*)::text FROM first_seen WHERE first_day = $1::date) AS cohort,
            (SELECT count(*)::text FROM first_seen f
              WHERE f.first_day = $1::date
                AND EXISTS (SELECT 1 FROM analytics.event_logs e
                             WHERE ${ACTOR_SQL} = f.actor
                               AND (occurred_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date + $2::int)) AS retained`,
    [cohortDay, String(offset)],
  );

  return {
    rows,
    cohort: Number(stat[0]?.cohort ?? 0),
    retained: Number(stat[0]?.retained ?? 0),
  };
}

// ------------------------------------------------------------
// 9. 概览对比上一周期
// ------------------------------------------------------------
export interface PeriodDelta {
  active: number | null;
  new_users: number | null;
  avg_duration_ms: number | null;
  d1_rate: number | null;
  sessions: number | null;
}

/** 上一个等长周期 → 变化率（无基数时返回 null，不编造百分比） */
export async function getPreviousPeriod(r: BehaviorRange): Promise<BehaviorOverview> {
  const span =
    Math.round(
      (new Date(r.to + 'T00:00:00Z').getTime() - new Date(r.from + 'T00:00:00Z').getTime()) / 86_400_000,
    ) + 1;
  const prevTo = new Date(r.from + 'T00:00:00Z');
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (span - 1));
  return getBehaviorOverview({
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  });
}
