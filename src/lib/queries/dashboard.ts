import { query } from '@/lib/db';

// ============================================================
// 看板查询层
// 所有指标口径严格按《埋点需求文档》05.1
// ============================================================

export interface OverviewMetrics {
  sessions: number;
  messages: number;
  runs: number;
  ended_runs: number;
  success_runs: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  feedback_total: number;
  negative_feedback: number;
  negative_rate: number | null;
  reviewed: number;
  confirmed_bad: number;
  /** ★ 真实坏例子率 = 确认坏 / 全部已评审。文档 05.1 的口径 */
  bad_case_rate: number | null;
  cases_open: number;
  running_stale: number;
}

export async function getOverview(days: number): Promise<OverviewMetrics> {
  const rows = await query<Record<string, string | null>>(
    `WITH bounds AS (
       SELECT now() - ($1 || ' days')::interval AS since
     ),
     ev AS (
       SELECT event_name, session_id, message_id
         FROM analytics.event_logs, bounds
        WHERE occurred_at >= bounds.since
     ),
     r AS (
       SELECT * FROM analytics.agent_runs, bounds
        WHERE started_at >= bounds.since
     )
     SELECT
       (SELECT count(DISTINCT session_id) FROM ev WHERE event_name = 'session_start') AS sessions,
       (SELECT count(DISTINCT message_id) FROM ev WHERE event_name = 'message_send') AS messages,
       (SELECT count(*) FROM r) AS runs,
       (SELECT count(*) FROM r WHERE status <> 'running') AS ended_runs,
       (SELECT count(*) FROM r WHERE status = 'success') AS success_runs,
       (SELECT avg(duration_ms) FROM r WHERE status = 'success') AS avg_duration_ms,
       (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
          FROM r WHERE status = 'success') AS p95_duration_ms,
       (SELECT count(*) FROM r WHERE last_feedback IS NOT NULL) AS feedback_total,
       (SELECT count(*) FROM r WHERE last_feedback = 'negative') AS negative_feedback,
       (SELECT count(*) FROM analytics.reviews, bounds WHERE reviewed_at >= bounds.since) AS reviewed,
       (SELECT count(*) FROM analytics.case_records, bounds WHERE created_at >= bounds.since) AS confirmed_bad,
       (SELECT count(*) FROM r WHERE status = 'running') AS running_stale,
       (SELECT count(*) FROM analytics.case_records WHERE status IN ('open','fixing')) AS cases_open
    `,
    [String(days)],
  );

  const d = rows[0] ?? {};
  const n = (k: string) => (d[k] === null || d[k] === undefined ? 0 : Number(d[k]));
  const nullable = (k: string) => (d[k] === null || d[k] === undefined ? null : Number(d[k]));

  const ended = n('ended_runs');
  const success = n('success_runs');
  const feedbackTotal = n('feedback_total');
  const reviewed = n('reviewed');
  const confirmedBad = n('confirmed_bad');

  return {
    sessions: n('sessions'),
    messages: n('messages'),
    runs: n('runs'),
    ended_runs: ended,
    success_runs: success,
    success_rate: ended > 0 ? success / ended : null,
    avg_duration_ms: nullable('avg_duration_ms'),
    p95_duration_ms: nullable('p95_duration_ms'),
    feedback_total: feedbackTotal,
    negative_feedback: n('negative_feedback'),
    negative_rate: feedbackTotal > 0 ? n('negative_feedback') / feedbackTotal : null,
    reviewed,
    confirmed_bad: confirmedBad,
    // ★ 分母是全部已评审请求，不是已入 Case 的数量
    bad_case_rate: reviewed > 0 ? confirmedBad / reviewed : null,
    cases_open: n('cases_open'),
    running_stale: n('running_stale'),
  };
}

/** 按天趋势 */
export interface TrendPoint {
  day: string;
  sessions: number;
  messages: number;
  runs: number;
  success: number;
  errors: number;
  timeouts: number;
  negative: number;
  avg_duration_ms: number | null;
}

export async function getTrend(days: number): Promise<TrendPoint[]> {
  const rows = await query<Record<string, string | null>>(
    `WITH days AS (
       SELECT generate_series(
         (now() - ($1 || ' days')::interval)::date,
         now()::date,
         '1 day'
       )::date AS day
     ),
     ev AS (
       SELECT occurred_at::date AS day, event_name, session_id, message_id
         FROM analytics.event_logs
        WHERE occurred_at >= now() - ($1 || ' days')::interval
     ),
     r AS (
       SELECT started_at::date AS day, status, duration_ms, last_feedback
         FROM analytics.agent_runs
        WHERE started_at >= now() - ($1 || ' days')::interval
     )
     SELECT to_char(d.day,'YYYY-MM-DD') AS day,
       (SELECT count(DISTINCT session_id) FROM ev WHERE ev.day = d.day AND event_name='session_start') AS sessions,
       (SELECT count(DISTINCT message_id) FROM ev WHERE ev.day = d.day AND event_name='message_send') AS messages,
       (SELECT count(*) FROM r WHERE r.day = d.day) AS runs,
       (SELECT count(*) FROM r WHERE r.day = d.day AND status='success') AS success,
       (SELECT count(*) FROM r WHERE r.day = d.day AND status='error') AS errors,
       (SELECT count(*) FROM r WHERE r.day = d.day AND status='timeout') AS timeouts,
       (SELECT count(*) FROM r WHERE r.day = d.day AND last_feedback='negative') AS negative,
       (SELECT avg(duration_ms) FROM r WHERE r.day = d.day AND status='success') AS avg_duration_ms
     FROM days d ORDER BY d.day`,
    [String(days)],
  );

  return rows.map((x) => ({
    day: String(x.day),
    sessions: Number(x.sessions ?? 0),
    messages: Number(x.messages ?? 0),
    runs: Number(x.runs ?? 0),
    success: Number(x.success ?? 0),
    errors: Number(x.errors ?? 0),
    timeouts: Number(x.timeouts ?? 0),
    negative: Number(x.negative ?? 0),
    avg_duration_ms: x.avg_duration_ms === null ? null : Number(x.avg_duration_ms),
  }));
}

/** 错误码分布 */
export async function getErrorBreakdown(days: number) {
  return query<{ error_code: string; count: string }>(
    `SELECT COALESCE(error_code,'UNKNOWN') AS error_code, count(*)::text AS count
       FROM analytics.agent_runs
      WHERE status IN ('error','timeout')
        AND started_at >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY count(*) DESC`,
    [String(days)],
  );
}

/** 模型维度表现 */
export async function getModelStats(days: number) {
  return query<Record<string, string | null>>(
    `SELECT COALESCE(model_version,'未知') AS model_version,
            count(*)::text AS runs,
            count(*) FILTER (WHERE status='success')::text AS success,
            count(*) FILTER (WHERE status IN ('error','timeout'))::text AS failed,
            avg(duration_ms)::text AS avg_duration_ms,
            count(*) FILTER (WHERE last_feedback='negative')::text AS negative
       FROM analytics.agent_runs
      WHERE started_at >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY count(*) DESC`,
    [String(days)],
  );
}

// ------------------------------------------------------------
// 运行列表
// ------------------------------------------------------------
export interface RunFilters {
  days?: number;
  status?: string;
  feedback?: string;
  model?: string;
  errorCode?: string;
  reviewVerdict?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface RunRow {
  request_id: string;
  session_id: string;
  message_id: string;
  status: string;
  started_at: string;
  duration_ms: number | null;
  model_version: string | null;
  prompt_version: string | null;
  error_code: string | null;
  last_feedback: string | null;
  review_verdict: string | null;
  case_id: string | null;
  case_title: string | null;
  case_severity: string | null;
  original_request_id: string | null;
  retry_count: number;
}

export async function listRuns(f: RunFilters): Promise<{ rows: RunRow[]; total: number }> {
  const where: string[] = [`r.started_at >= now() - ($1 || ' days')::interval`];
  const params: unknown[] = [String(f.days ?? 7)];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  // 注意：join case_records 后 status/review_verdict 等同名列会歧义，必须带 r. 前缀
  if (f.status) add(`r.status = ?`, f.status);
  if (f.feedback) {
    if (f.feedback === 'none') where.push(`r.last_feedback IS NULL`);
    else add(`r.last_feedback = ?`, f.feedback);
  }
  if (f.model) add(`r.model_version = ?`, f.model);
  if (f.errorCode) add(`r.error_code = ?`, f.errorCode);
  if (f.reviewVerdict) {
    if (f.reviewVerdict === 'unreviewed') where.push(`r.review_verdict IS NULL`);
    else add(`r.review_verdict = ?`, f.reviewVerdict);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    const p = `$${params.length}`;
    where.push(`(r.request_id ILIKE ${p} OR r.session_id ILIKE ${p} OR r.message_id ILIKE ${p})`);
  }

  const whereSql = where.join(' AND ');
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const offset = ((f.page ?? 1) - 1) * pageSize;

  const countRow = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM analytics.agent_runs r WHERE ${whereSql}`,
    params,
  );

  params.push(pageSize, offset);
  const rows = await query<RunRow>(
    `SELECT r.request_id, r.session_id, r.message_id, r.status,
            to_char(r.started_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS started_at,
            r.duration_ms, r.model_version, r.prompt_version, r.error_code,
            r.last_feedback, r.review_verdict, r.original_request_id,
            c.id AS case_id, c.title AS case_title, c.severity AS case_severity,
            (SELECT count(*)::int FROM analytics.agent_runs x
              WHERE x.original_request_id = r.request_id) AS retry_count
       FROM analytics.agent_runs r
       LEFT JOIN analytics.case_records c ON c.request_id = r.request_id
      WHERE ${whereSql}
      ORDER BY r.started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { rows, total: Number(countRow[0]?.count ?? 0) };
}

/** 筛选项的候选值 */
export async function getFilterOptions() {
  const models = await query<{ model_version: string }>(
    `SELECT DISTINCT model_version FROM analytics.agent_runs
      WHERE model_version IS NOT NULL ORDER BY 1`,
  );
  const errorCodes = await query<{ error_code: string }>(
    `SELECT DISTINCT error_code FROM analytics.agent_runs
      WHERE error_code IS NOT NULL ORDER BY 1`,
  );
  return {
    models: models.map((m) => m.model_version),
    errorCodes: errorCodes.map((e) => e.error_code),
  };
}
// ------------------------------------------------------------
// 单条运行详情（复盘主界面）
// ------------------------------------------------------------
export interface TimelineItem {
  at: string;
  event_name: string;
  source: string;
  detail: string | null;
}

export async function getRunDetail(requestId: string) {
  const runRows = await query<Record<string, unknown>>(
    `SELECT r.*,
            to_char(r.started_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS started_at_local,
            to_char(r.ended_at   AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS ended_at_local,
            c.id AS case_id, c.title AS case_title, c.category AS case_category,
            c.severity AS case_severity, c.status AS case_status,
            c.description AS case_description, c.expected_behavior AS case_expected,
            c.owner AS case_owner, c.fix_version AS case_fix_version,
            rv.note AS review_note, rv.reviewer AS review_reviewer,
            to_char(rv.reviewed_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS review_at
       FROM analytics.agent_runs r
       LEFT JOIN analytics.case_records c ON c.request_id = r.request_id
       LEFT JOIN analytics.reviews rv ON rv.request_id = r.request_id
      WHERE r.request_id = $1`,
    [requestId],
  );
  if (!runRows.length) return null;

  const timeline = await query<TimelineItem>(
    `SELECT to_char(occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.MS') AS at,
            event_name, source, properties::text AS detail
       FROM analytics.event_logs
      WHERE request_id = $1
      ORDER BY occurred_at`,
    [requestId],
  );

  const feedbacks = await query<Record<string, unknown>>(
    `SELECT value, reason_tags, comment, created_by,
            to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS created_at
       FROM analytics.feedbacks WHERE request_id = $1 ORDER BY created_at`,
    [requestId],
  );

  const sessionRuns = await query<Record<string, unknown>>(
    `SELECT request_id, message_id, status, duration_ms, last_feedback,
            to_char(started_at AT TIME ZONE 'Asia/Shanghai','HH24:MI:SS') AS started_at
       FROM analytics.agent_runs
      WHERE session_id = (SELECT session_id FROM analytics.agent_runs WHERE request_id = $1)
      ORDER BY started_at`,
    [requestId],
  );

  return {
    run: runRows[0],
    timeline,
    feedbacks,
    sessionRuns,
  };
}

// ------------------------------------------------------------
// Case 集
// ------------------------------------------------------------
export async function listCases(filters: {
  status?: string;
  severity?: string;
  category?: string;
  search?: string;
}) {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (filters.status) add(`c.status = ?`, filters.status);
  if (filters.severity) add(`c.severity = ?`, filters.severity);
  if (filters.category) add(`c.category = ?`, filters.category);
  if (filters.search) add(`(c.title ILIKE ? OR c.description ILIKE ?)`, `%${filters.search}%`);

  return query<Record<string, unknown>>(
    `SELECT c.*, r.status AS run_status, r.model_version, r.last_feedback,
            to_char(r.started_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI') AS run_started_at
       FROM analytics.case_records c
       JOIN analytics.agent_runs r ON r.request_id = c.request_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE c.status WHEN 'open' THEN 0 WHEN 'fixing' THEN 1 WHEN 'fixed' THEN 2 ELSE 3 END,
        CASE c.severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
        c.created_at DESC`,
    params,
  );
}

export interface CaseStats {
  total: string;
  open: string;
  fixing: string;
  fixed: string;
  p0: string;
  p1: string;
  p2: string;
  categories: { category: string; count: string }[];
}

export async function getCaseStats(): Promise<CaseStats> {
  const rows = await query<Record<string, string>>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE status='open')::text AS open,
       count(*) FILTER (WHERE status='fixing')::text AS fixing,
       count(*) FILTER (WHERE status='fixed')::text AS fixed,
       count(*) FILTER (WHERE severity='P0')::text AS p0,
       count(*) FILTER (WHERE severity='P1')::text AS p1,
       count(*) FILTER (WHERE severity='P2')::text AS p2
     FROM analytics.case_records`,
  );
  const cats = await query<{ category: string; count: string }>(
    `SELECT COALESCE(category,'未分类') AS category, count(*)::text AS count
       FROM analytics.case_records GROUP BY 1 ORDER BY count(*) DESC`,
  );
  const r = rows[0] ?? {};
  const val = (k: string) => r[k] ?? '0';
  return {
    total: val('total'),
    open: val('open'),
    fixing: val('fixing'),
    fixed: val('fixed'),
    p0: val('p0'),
    p1: val('p1'),
    p2: val('p2'),
    categories: cats,
  };
}

// ------------------------------------------------------------
// 埋点自检（对应文档第 06 章 A01–A10）
// ------------------------------------------------------------
export interface HealthCheck {
  id: string;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export async function runHealthChecks(days = 7): Promise<HealthCheck[]> {
  const q = async (sql: string, withParam = true) => {
    const r = await query<Record<string, string | null>>(sql, withParam ? [String(days)] : []);
    return r[0] ?? {};
  };

  const basic = await q(`
    SELECT
      (SELECT count(*) FROM analytics.event_logs
        WHERE occurred_at >= now() - ($1||' days')::interval)::text AS total_events,
      (SELECT count(*) FROM analytics.agent_runs
        WHERE started_at >= now() - ($1||' days')::interval)::text AS total_runs,
      (SELECT count(*) FROM analytics.agent_runs
        WHERE started_at >= now() - ($1||' days')::interval
          AND request_id NOT IN (SELECT request_id FROM analytics.event_logs WHERE event_name='agent_request_start' AND request_id IS NOT NULL))::text AS missing_start,
      (SELECT count(*) FROM analytics.agent_runs
        WHERE status='running' AND started_at < now() - interval '10 minutes')::text AS stale_running,
      (SELECT count(*) FROM analytics.agent_runs r
        WHERE started_at >= now() - ($1||' days')::interval
          AND r.status='success' AND r.duration_ms IS NULL)::text AS success_no_duration,
      (SELECT count(*) FROM analytics.agent_runs r
        WHERE started_at >= now() - ($1||' days')::interval
          AND r.status='success' AND r.model_version IS NULL)::text AS success_no_model,
      (SELECT count(*) FROM analytics.event_logs
        WHERE occurred_at >= now() - ($1||' days')::interval
          AND event_name='agent_error' AND (properties->>'error_code') IS NULL)::text AS error_no_code,
      (SELECT count(*) FROM analytics.feedbacks f
        WHERE NOT EXISTS (SELECT 1 FROM analytics.agent_runs r WHERE r.request_id=f.request_id))::text AS orphan_feedback,
      (SELECT count(*) FROM analytics.agent_runs
        WHERE started_at >= now() - ($1||' days')::interval
          AND input_text IS NOT NULL)::text AS pii_rows,
      (SELECT count(*) FROM analytics.event_logs
        WHERE occurred_at >= now() - ($1||' days')::interval
          AND occurred_at > now() + interval '5 minutes')::text AS future_events,
      (SELECT count(*) FROM analytics.event_logs
        WHERE occurred_at >= now() - ($1||' days')::interval
          AND (properties ? 'user_id_hash' OR properties ? 'anonymous_id'))::text AS with_identity
  `);

  const num = (k: string) => Number(basic[k] ?? 0);
  const checks: HealthCheck[] = [];

  checks.push({
    id: 'A05',
    name: '事件 ID 幂等去重',
    status: 'pass',
    detail: `event_logs 以 event_id 为主键，重复上报返回 inserted=false。本期事件总数 ${num('total_events')}。`,
  });

  checks.push({
    id: 'A07',
    name: '公共必填字段完整性',
    status: num('missing_start') === 0 ? 'pass' : 'warn',
    detail:
      num('missing_start') === 0
        ? '所有执行记录都有对应的 agent_request_start 事件。'
        : `${num('missing_start')} 条执行记录缺少 E03 起始事件，可能存在漏埋点。`,
  });

  checks.push({
    id: 'E04',
    name: '成功执行包含 duration_ms 与 model_version',
    status:
      num('success_no_duration') === 0 && num('success_no_model') === 0 ? 'pass' : 'warn',
    detail: `缺少 duration_ms：${num('success_no_duration')} 条；缺少 model_version：${num('success_no_model')} 条。`,
  });

  checks.push({
    id: 'E05',
    name: '错误执行包含规范化 error_code',
    status: num('error_no_code') === 0 ? 'pass' : 'warn',
    detail:
      num('error_no_code') === 0
        ? '所有 agent_error 事件都带有 error_code。'
        : `${num('error_no_code')} 条 agent_error 缺少 error_code，错误分布图会失真。`,
  });

  checks.push({
    id: '03.1',
    name: 'Agent 运行无长期挂起',
    status: num('stale_running') === 0 ? 'pass' : 'fail',
    detail:
      num('stale_running') === 0
        ? '没有超过 10 分钟仍为 running 的记录。'
        : `${num('stale_running')} 条记录长时间 running，需调用 /api/v1/reap 兜底。`,
  });

  checks.push({
    id: 'E06',
    name: '反馈可关联到具体执行',
    status: num('orphan_feedback') === 0 ? 'pass' : 'fail',
    detail:
      num('orphan_feedback') === 0
        ? '所有反馈都能找到对应的 agent_run。'
        : `${num('orphan_feedback')} 条反馈找不到对应执行，反馈率不可信。`,
  });

  checks.push({
    id: 'A10',
    name: '默认不落聊天原文',
    status: num('pii_rows') === 0 ? 'pass' : 'warn',
    detail:
      num('pii_rows') === 0
        ? 'agent_runs 中没有存储原文。event_logs.properties 已按白名单过滤。'
        : `${num('pii_rows')} 条记录包含原文，确认 ENABLE_PII_STORAGE 是否应开启。`,
  });

  checks.push({
    id: 'A07b',
    name: '时间口径统一（无未来时间）',
    status: num('future_events') === 0 ? 'pass' : 'warn',
    detail:
      num('future_events') === 0
        ? '未发现超出当前时间 5 分钟以上的事件。'
        : `${num('future_events')} 条事件时间在未来，可能存在客户端时钟错误。`,
  });

  checks.push({
    id: 'A11',
    name: '用户标识可用于行为分析',
    status: num('with_identity') > 0 ? 'pass' : 'warn',
    detail:
      num('with_identity') > 0
        ? `${num('with_identity')} 条事件带有 user_id_hash / anonymous_id，用户行为分析按用户口径统计。`
        : '没有任何事件带 user_id_hash / anonymous_id，用户行为分析只能退化为会话口径，DAU 与留存会失真。产品侧需在事件 properties 里上报登录用户 id 的 sha256。',
  });

  const reviewed = await q(
    `
    SELECT (SELECT count(*) FROM analytics.reviews)::text AS reviewed,
           (SELECT count(*) FROM analytics.case_records)::text AS cases
  `,
    false,
  );
  checks.push({
    id: '05.1',
    name: '坏例子率分母正确（已评审请求）',
    status: Number(reviewed.reviewed ?? 0) > 0 ? 'pass' : 'warn',
    detail: `已评审 ${reviewed.reviewed ?? 0} 条，入 Case ${reviewed.cases ?? 0} 条。坏例子率 = 入 Case 数 ÷ 已评审数，不使用「已入 Case ÷ 已入 Case」这种自证式算法。`,
  });

  return checks;
}

/** 会话维度：看一个会话里发生了什么 */
export async function listSessions(days: number) {
  return query<Record<string, string>>(
    `SELECT s.session_id,
            to_char(min(s.occurred_at) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI') AS started_at,
            count(DISTINCT CASE WHEN s.event_name='message_send' THEN s.message_id END)::text AS messages,
            (SELECT count(*)::text FROM analytics.agent_runs r WHERE r.session_id = s.session_id) AS runs,
            (SELECT count(*)::text FROM analytics.agent_runs r WHERE r.session_id = s.session_id AND r.last_feedback='negative') AS negative,
            (SELECT count(*)::text FROM analytics.agent_runs r WHERE r.session_id = s.session_id AND r.status IN ('error','timeout')) AS failed
       FROM analytics.event_logs s
      WHERE s.occurred_at >= now() - ($1 || ' days')::interval
      GROUP BY s.session_id
      ORDER BY min(s.occurred_at) DESC
      LIMIT 200`,
    [String(days)],
  );
}
