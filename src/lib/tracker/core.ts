import { query, withTransaction } from '@/lib/db';
import {
  EVENT_NAMES,
  filterProperties,
  validateRequiredProperties,
  type EventName,
  type EventPayload,
} from '@/lib/schema';

// ============================================================
// 埋点写入核心
// 纯函数 + DB 操作，HTTP 接口和直连模式共用这一层。
// 产品侧以后若想跳过 HTTP 直接写库，import 这里的函数即可。
// ============================================================

export interface IngestResult {
  event_id: string;
  event_name: string;
  /** true = 首次写入；false = event_id 已存在被跳过（文档 A05） */
  inserted: boolean;
  rejected_properties?: string[];
  error?: string;
}

// ------------------------------------------------------------
// E01–E08 通用事件写入
// ------------------------------------------------------------
export async function ingestEvent(raw: EventPayload): Promise<IngestResult> {
  const { allowed, rejected } = filterProperties(raw.event_name, raw.properties);

  const requiredError = validateRequiredProperties(raw.event_name, allowed);
  if (requiredError) {
    return {
      event_id: raw.event_id,
      event_name: raw.event_name,
      inserted: false,
      error: requiredError,
    };
  }

  // 时间口径：occurred_at 由服务端补充/纠正，不信前端（文档 04）
  const occurredAt = resolveOccurredAt(raw.occurred_at);

  const rows = await query<{ event_id: string }>(
    `INSERT INTO analytics.event_logs
       (event_id, event_name, occurred_at, session_id, message_id, request_id,
        source, schema_version, properties)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      raw.event_id,
      raw.event_name,
      occurredAt,
      raw.session_id,
      raw.message_id ?? null,
      raw.request_id ?? null,
      raw.source,
      raw.schema_version,
      JSON.stringify(allowed),
    ],
  );

  const inserted = rows.length > 0;

  // 反馈事件额外维护 agent_runs.last_feedback（文档 03.1：保留最新有效反馈）
  if (inserted && raw.event_name === 'feedback_submit' && raw.request_id) {
    await applyFeedback(raw.request_id, raw.session_id, allowed.feedback_value as string, allowed);
  }

  return {
    event_id: raw.event_id,
    event_name: raw.event_name,
    inserted,
    ...(rejected.length ? { rejected_properties: rejected } : {}),
  };
}

/**
 * 时间处理：
 * - 没传 → 用服务端时间
 * - 传了但超前 > 5 分钟（明显是前端时钟错/恶意）→ 用服务端时间
 * - 其余照用
 */
function resolveOccurredAt(input?: string): Date {
  const now = new Date();
  if (!input) return now;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return now;
  if (parsed.getTime() - now.getTime() > 5 * 60 * 1000) return now;
  return parsed;
}

async function applyFeedback(
  requestId: string,
  sessionId: string,
  value: string,
  props: Record<string, unknown>,
) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO analytics.feedbacks (request_id, session_id, value, reason_tags)
       SELECT $1,$2,$3,$4
       WHERE EXISTS (SELECT 1 FROM analytics.agent_runs WHERE request_id = $1)`,
      [requestId, sessionId, value, Array.isArray(props.reason_tags) ? props.reason_tags : []],
    );

    await client.query(
      `UPDATE analytics.agent_runs
          SET last_feedback = $2, feedback_updated_at = now()
        WHERE request_id = $1`,
      [requestId, value],
    );
  });
}

// ------------------------------------------------------------
// E03 Agent 开始执行 → agent_runs 建行 status=running
// ------------------------------------------------------------
export interface StartRunInput {
  session_id: string;
  message_id: string;
  request_id: string;
  model_version?: string | null;
  prompt_version?: string | null;
  original_request_id?: string | null;
  is_auto_retry?: boolean;
  input_text?: string | null;
  /** 是否允许存原文，由调用方按配置传入 */
  store_pii?: boolean;
}

export async function startAgentRun(input: StartRunInput): Promise<{ created: boolean }> {
  const rows = await query<{ request_id: string }>(
    `INSERT INTO analytics.agent_runs
       (request_id, session_id, message_id, status, started_at,
        model_version, prompt_version, original_request_id, is_auto_retry, input_text)
     VALUES ($1,$2,$3,'running', now(), $4,$5,$6,$7,$8)
     ON CONFLICT (request_id) DO NOTHING
     RETURNING request_id`,
    [
      input.request_id,
      input.session_id,
      input.message_id,
      input.model_version ?? null,
      input.prompt_version ?? null,
      input.original_request_id ?? null,
      input.is_auto_retry ?? false,
      input.store_pii ? (input.input_text ?? null) : null,
    ],
  );

  // 同步写一条 E03 事件，保证 event_logs 里也有痕迹
  await query(
    `INSERT INTO analytics.event_logs
       (event_id, event_name, occurred_at, session_id, message_id, request_id,
        source, schema_version, properties)
     VALUES (gen_random_uuid(),'agent_request_start', now(), $1,$2,$3,'server',1,$4)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      input.session_id,
      input.message_id,
      input.request_id,
      JSON.stringify({
        prompt_version: input.prompt_version ?? null,
        original_request_id: input.original_request_id ?? null,
        is_auto_retry: input.is_auto_retry ?? false,
      }),
    ],
  );

  return { created: rows.length > 0 };
}

// ------------------------------------------------------------
// E04 / E05 Agent 结束 → 状态机收敛
// 关键：WHERE status = 'running' 保证只终结一次（文档 03.1 互斥要求）
// ------------------------------------------------------------
export interface EndRunInput {
  request_id: string;
  status: 'success' | 'error' | 'timeout';
  duration_ms?: number;
  model_version?: string | null;
  prompt_version?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  output_text?: string | null;
  store_pii?: boolean;
}

export interface EndRunResult {
  updated: boolean;
  /** 已经终结过，本次被忽略 */
  already_ended: boolean;
  final_status?: string;
}

export async function endAgentRun(input: EndRunInput): Promise<EndRunResult> {
  const endedAt = new Date();

  const rows = await query<{ request_id: string; status: string; session_id: string; message_id: string; duration_ms: number | null }>(
    `UPDATE analytics.agent_runs
        SET status        = $2,
            ended_at      = $3,
            duration_ms   = COALESCE(
                              $4::int,
                              GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($3 - started_at)) * 1000)::int)
                            ),
            model_version  = COALESCE($5, model_version),
            prompt_version = COALESCE($6, prompt_version),
            error_code     = $7,
            error_message  = $8,
            output_text    = CASE WHEN $9 THEN $10 ELSE output_text END
      WHERE request_id = $1
        AND status = 'running'
      RETURNING request_id, status, session_id, message_id, duration_ms`,
    [
      input.request_id,
      input.status,
      endedAt,
      input.duration_ms ?? null,
      input.model_version ?? null,
      input.prompt_version ?? null,
      input.error_code ?? null,
      input.error_message ?? null,
      input.store_pii ?? false,
      input.output_text ?? null,
    ],
  );

  if (rows.length > 0) {
    const run = rows[0];
    // 补写对应的 E04 / E05 事件
    await query(
      `INSERT INTO analytics.event_logs
         (event_id, event_name, occurred_at, session_id, message_id, request_id,
          source, schema_version, properties)
       VALUES (gen_random_uuid(), $1, $2, $3,$4,$5,'server',1,$6)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        input.status === 'success' ? 'agent_response' : 'agent_error',
        endedAt,
        run.session_id,
        run.message_id,
        input.request_id,
        JSON.stringify(
          input.status === 'success'
            ? {
                duration_ms: run.duration_ms,
                model_version: input.model_version ?? null,
                prompt_version: input.prompt_version ?? null,
              }
            : {
                error_code: input.error_code ?? 'UNKNOWN',
                error_message: input.error_message ?? null,
                duration_ms: run.duration_ms,
              },
        ),
      ],
    );
    return { updated: true, already_ended: false, final_status: input.status };
  }

  const existing = await query<{ status: string }>(
    `SELECT status FROM analytics.agent_runs WHERE request_id = $1`,
    [input.request_id],
  );

  if (existing.length === 0) {
    // 没有 E03 就到了 E04/E05，属于漏埋点。补建一行，避免数据丢失
    await query(
      `INSERT INTO analytics.agent_runs
         (request_id, session_id, message_id, status, started_at, ended_at, duration_ms,
          model_version, prompt_version, error_code, error_message)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (request_id) DO NOTHING`,
      [
        input.request_id,
        'unknown-session',
        'unknown-message',
        input.status,
        endedAt,
        input.duration_ms ?? null,
        input.model_version ?? null,
        input.prompt_version ?? null,
        input.error_code ?? null,
        input.error_message ?? null,
      ],
    );
    return { updated: true, already_ended: false, final_status: input.status };
  }

  return { updated: false, already_ended: true, final_status: existing[0].status };
}

// ------------------------------------------------------------
// 超时兜底：把长时间 running 的置为 timeout（文档 03.1）
// ------------------------------------------------------------
export async function reapStaleRuns(timeoutMs: number): Promise<{ reaped: number; request_ids: string[] }> {
  const rows = await query<{ request_id: string; session_id: string; message_id: string }>(
    `UPDATE analytics.agent_runs
        SET status = 'timeout',
            ended_at = now(),
            duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int),
            error_code = 'TIMEOUT',
            error_message = 'reaped: running exceeded ' || $1 || 'ms'
      WHERE status = 'running'
        AND started_at < now() - ($1 || ' milliseconds')::interval
      RETURNING request_id, session_id, message_id`,
    [String(timeoutMs)],
  );

  for (const run of rows) {
    await query(
      `INSERT INTO analytics.event_logs
         (event_id, event_name, occurred_at, session_id, message_id, request_id,
          source, schema_version, properties)
       VALUES (gen_random_uuid(),'agent_error', now(), $1,$2,$3,'server',1,$4)`,
      [
        run.session_id,
        run.message_id,
        run.request_id,
        JSON.stringify({ error_code: 'TIMEOUT', error_message: 'reaped by watchdog' }),
      ],
    );
  }

  return { reaped: rows.length, request_ids: rows.map((r) => r.request_id) };
}

// ------------------------------------------------------------
// 方便产品侧一次性上报
// ------------------------------------------------------------
export function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value);
}
