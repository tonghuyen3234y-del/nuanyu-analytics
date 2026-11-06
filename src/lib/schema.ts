import { z } from 'zod';

// ============================================================
// 事件白名单与字段校验
// 对应《埋点需求文档》第 04 章
// ============================================================

/** 文档 04：event_name 白名单 E01–E08 */
export const EVENT_NAMES = [
  'session_start',
  'message_send',
  'agent_request_start',
  'agent_response',
  'agent_error',
  'feedback_submit',
  'retry_click',
  'session_end',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** 文档 04.1：允许写入 error_code 的规范化错误码 */
export const ERROR_CODES = [
  'TIMEOUT',
  'RATE_LIMIT',
  'UPSTREAM_ERROR',
  'CONTEXT_OVERFLOW',
  'TOOL_CALL_FAILED',
  'PARSE_ERROR',
  'AUTH_ERROR',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** 文档 03.1 E08 */
export const END_REASONS = ['explicit', 'timeout'] as const;

/**
 * 文档 04：properties 仅限批准的白名单键值。
 * 每个事件允许出现的键，其余一律拒绝，防止误传聊天原文进来（A10）。
 */
export const EVENT_PROPERTY_WHITELIST: Record<EventName, readonly string[]> = {
  session_start: ['end_reason', 'client_platform'],
  message_send: ['message_length', 'has_attachment'],
  agent_request_start: ['prompt_version', 'original_request_id', 'is_auto_retry'],
  agent_response: ['duration_ms', 'model_version', 'prompt_version', 'token_input', 'token_output'],
  agent_error: ['error_code', 'error_message', 'duration_ms', 'model_version'],
  feedback_submit: ['feedback_value', 'reason_tags'],
  retry_click: ['original_request_id'],
  session_end: ['end_reason'],
};

// ------------------------------------------------------------
// 单个事件上报体
// ------------------------------------------------------------
export const eventPayloadSchema = z.object({
  event_id: z.uuid({ message: 'event_id 必须是 UUID' }),
  event_name: z.enum(EVENT_NAMES),
  occurred_at: z.iso.datetime().optional(),
  session_id: z.string().min(1).max(200),
  message_id: z.string().min(1).max(200).nullish(),
  request_id: z.string().min(1).max(200).nullish(),
  source: z.enum(['web', 'server']),
  schema_version: z.number().int().positive().default(1),
  properties: z.record(z.string(), z.unknown()).default({}),
});

export type EventPayload = z.infer<typeof eventPayloadSchema>;

// ------------------------------------------------------------
// 批量上报
// ------------------------------------------------------------
export const batchPayloadSchema = z.object({
  events: z.array(eventPayloadSchema).min(1).max(200),
});

// ------------------------------------------------------------
// Agent 执行生命周期
// ------------------------------------------------------------
export const agentStartSchema = z.object({
  session_id: z.string().min(1).max(200),
  message_id: z.string().min(1).max(200),
  request_id: z.string().min(1).max(200),
  model_version: z.string().max(200).nullish(),
  prompt_version: z.string().max(200).nullish(),
  original_request_id: z.string().max(200).nullish(),
  is_auto_retry: z.boolean().default(false),
  /** 文档 A10：默认不传。传了也要看服务端是否允许存储 */
  input_text: z.string().nullish(),
});

export const agentEndSchema = z.object({
  request_id: z.string().min(1).max(200),
  status: z.enum(['success', 'error', 'timeout']),
  duration_ms: z.number().int().min(0).optional(),
  model_version: z.string().max(200).nullish(),
  prompt_version: z.string().max(200).nullish(),
  error_code: z.enum(ERROR_CODES).nullish(),
  error_message: z.string().max(2000).nullish(),
  output_text: z.string().nullish(),
});

export type AgentStartPayload = z.infer<typeof agentStartSchema>;
export type AgentEndPayload = z.infer<typeof agentEndSchema>;

// ------------------------------------------------------------
// 人工评审 / Case
// ------------------------------------------------------------
export const reviewSchema = z.object({
  request_id: z.string().min(1),
  verdict: z.enum(['ok', 'bad', 'unsure']),
  note: z.string().max(5000).nullish(),
  reviewer: z.string().min(1).max(100),
});

export const caseCreateSchema = z.object({
  request_id: z.string().min(1),
  title: z.string().min(1).max(300),
  category: z.string().max(100).nullish(),
  severity: z.enum(['P0', 'P1', 'P2']).default('P2'),
  description: z.string().min(1).max(10000),
  expected_behavior: z.string().max(10000).nullish(),
  status: z.enum(['open', 'fixing', 'fixed', 'wontfix']).default('open'),
  owner: z.string().max(100).nullish(),
  fix_version: z.string().max(100).nullish(),
  created_by: z.string().min(1).max(100),
});

export const caseUpdateSchema = caseCreateSchema.partial().omit({ request_id: true, created_by: true });

// ------------------------------------------------------------
// 白名单过滤
// ------------------------------------------------------------
export interface PropertyFilterResult {
  allowed: Record<string, unknown>;
  rejected: string[];
}

/**
 * 只保留该事件白名单内的键。
 * 返回被丢弃的键名，便于调用方记录告警（说明有人误传了不该传的东西）。
 *
 * 用户行为分析需要的 user_id_hash / anonymous_id 是跨事件通用的，
 * 因此按统一规则单独校验，不逐个事件塞进白名单（见 filterUserIdentity）。
 */
export function filterProperties(
  eventName: EventName,
  properties: Record<string, unknown>,
): PropertyFilterResult {
  const whitelist = EVENT_PROPERTY_WHITELIST[eventName] ?? [];
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(properties)) {
    if (whitelist.includes(key) || IDENTITY_KEYS.includes(key)) {
      allowed[key] = value;
    } else {
      rejected.push(key);
    }
  }

  const rejectedIdentity = filterUserIdentity(allowed);
  rejected.push(...rejectedIdentity);

  return { allowed, rejected };
}

/**
 * 文档 A10：用户标识也是白名单过滤的，只接受摘要值。
 * 允许 32–128 位小写十六进制，即 sha256 / md5 摘要。
 * 明文手机号、邮箱、openid 一律拒绝，避免把 PII 写进 properties。
 */
const IDENTITY_KEYS = ['user_id_hash', 'anonymous_id'];
const USER_ID_PATTERN = /^[a-f0-9]{32,128}$/;

function filterUserIdentity(props: Record<string, unknown>): string[] {
  const rejected: string[] = [];
  for (const key of IDENTITY_KEYS) {
    if (key in props) {
      const v = props[key];
      if (typeof v !== 'string' || !USER_ID_PATTERN.test(v)) {
        rejected.push(key);
        delete props[key];
      }
    }
  }
  return rejected;
}

/**
 * 「必填扩展字段」校验。
 * 文档 04.1 标了必填的，缺了就不该入库。
 */
export function validateRequiredProperties(
  eventName: EventName,
  props: Record<string, unknown>,
): string | null {
  switch (eventName) {
    case 'agent_response':
      if (typeof props.duration_ms !== 'number') return 'agent_response 缺少 duration_ms';
      if (typeof props.model_version !== 'string') return 'agent_response 缺少 model_version';
      return null;
    case 'agent_error':
      if (typeof props.error_code !== 'string') return 'agent_error 缺少 error_code';
      return null;
    case 'feedback_submit':
      if (props.feedback_value !== 'positive' && props.feedback_value !== 'negative') {
        return 'feedback_submit 的 feedback_value 必须是 positive 或 negative';
      }
      return null;
    case 'session_end':
      if (props.end_reason !== 'explicit' && props.end_reason !== 'timeout') {
        return 'session_end 的 end_reason 必须是 explicit 或 timeout';
      }
      return null;
    default:
      return null;
  }
}
