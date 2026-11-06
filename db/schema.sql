-- ============================================================
-- 暖屿 Case 集后台 · 数据库结构
-- 对应《埋点需求文档》第 04 章字段字典 + 第 05 章数据去向
-- 目标库：PostgreSQL 14+
-- ============================================================

CREATE SCHEMA IF NOT EXISTS analytics;
SET search_path TO analytics, public;

-- ------------------------------------------------------------
-- 1. event_logs  原始埋点事件表
--    E01/E02/E06/E07/E08 全部落这里。只追加，永不 UPDATE。
--    event_id 主键 = 文档 A05「重发去重」的直接实现
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.event_logs (
  event_id        UUID          PRIMARY KEY,
  event_name      TEXT          NOT NULL,
  occurred_at     TIMESTAMPTZ   NOT NULL,
  received_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  session_id      TEXT          NOT NULL,
  message_id      TEXT,
  request_id      TEXT,
  source          TEXT          NOT NULL CHECK (source IN ('web', 'server')),
  schema_version  INTEGER       NOT NULL DEFAULT 1,
  -- 只允许写入白名单键值，见 lib/schema.ts 的 EVENT_PROPERTY_WHITELIST
  properties      JSONB         NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT event_name_valid CHECK (event_name IN (
    'session_start', 'message_send',
    'agent_request_start', 'agent_response', 'agent_error',
    'feedback_submit', 'retry_click', 'session_end'
  )),
  -- 文档 03.1：消息事件必须带 message_id
  CONSTRAINT message_id_required CHECK (
    event_name NOT IN ('message_send', 'agent_request_start') OR message_id IS NOT NULL
  ),
  -- 文档 03.1：Agent 相关事件必须带 request_id
  CONSTRAINT request_id_required CHECK (
    event_name NOT IN ('agent_request_start', 'agent_response', 'agent_error', 'feedback_submit')
    OR request_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_event_logs_time
  ON analytics.event_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_name_time
  ON analytics.event_logs (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_session
  ON analytics.event_logs (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_request
  ON analytics.event_logs (request_id) WHERE request_id IS NOT NULL;

COMMENT ON TABLE analytics.event_logs IS '原始埋点事件，只追加不修改。event_id 幂等。';


-- ------------------------------------------------------------
-- 2. agent_runs  AI 执行记录（文档 05 节的核心表）
--    E03 建行 status=running；E04 置 success；E05 置 error/timeout
--    状态机约束保证 E04/E05 互斥且只终结一次（文档 03.1）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.agent_runs (
  request_id            TEXT        PRIMARY KEY,
  session_id            TEXT        NOT NULL,
  message_id            TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'success', 'error', 'timeout')),

  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  duration_ms           INTEGER     CHECK (duration_ms IS NULL OR duration_ms >= 0),

  -- 文档 03.1：model_version / prompt_version 由后端真实配置写入，不由前端填
  model_version         TEXT,
  prompt_version        TEXT,

  error_code            TEXT,
  error_message         TEXT,

  -- 文档 03.1 E07：重试链路
  original_request_id   TEXT,
  is_auto_retry         BOOLEAN     NOT NULL DEFAULT FALSE,

  -- 用户反馈：只保留最新有效值（文档 03.1 E06 口径）
  last_feedback         TEXT        CHECK (last_feedback IN ('positive', 'negative')),
  feedback_updated_at   TIMESTAMPTZ,

  -- 复核结论冗余，便于一眼筛出未评审的
  -- ok=评审为正常 / bad=已入 Case 集 / unsure=待定 / NULL=未评审
  review_verdict        TEXT        CHECK (review_verdict IN ('ok', 'bad', 'unsure')),

  -- 文档 A10：默认不存原文。只有显式开启才写入
  input_text            TEXT,
  output_text           TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ended_requires_status CHECK (
    (status = 'running' AND ended_at IS NULL AND duration_ms IS NULL)
    OR (status <> 'running' AND ended_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status_start
  ON analytics.agent_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_start
  ON analytics.agent_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_feedback
  ON analytics.agent_runs (last_feedback) WHERE last_feedback IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_unreviewed
  ON analytics.agent_runs (started_at DESC) WHERE review_verdict IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_session
  ON analytics.agent_runs (session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_message
  ON analytics.agent_runs (message_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_model
  ON analytics.agent_runs (model_version);

COMMENT ON TABLE analytics.agent_runs IS 'AI 执行记录。status=running 时可由 reap 接口兜底置 timeout。';


-- ------------------------------------------------------------
-- 3. feedbacks  反馈历史（审计用）
--    指标口径用 agent_runs.last_feedback，本表只回答"改过几次、谁改的"
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.feedbacks (
  id           BIGSERIAL   PRIMARY KEY,
  request_id   TEXT        NOT NULL REFERENCES analytics.agent_runs (request_id) ON DELETE CASCADE,
  session_id   TEXT        NOT NULL,
  value        TEXT        NOT NULL CHECK (value IN ('positive', 'negative')),
  reason_tags  TEXT[]      NOT NULL DEFAULT '{}',
  comment      TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_request
  ON analytics.feedbacks (request_id, created_at DESC);


-- ------------------------------------------------------------
-- 4. reviews  人工评审记录  ★ 文档 05.1 特别警告的那张表 ★
--    Bad Case 率的分母必须是「全部已评审请求」，不是「已入 Case 集」
--    没有这张表，算不出真实坏例子率
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.reviews (
  request_id   TEXT        PRIMARY KEY REFERENCES analytics.agent_runs (request_id) ON DELETE CASCADE,
  verdict      TEXT        NOT NULL CHECK (verdict IN ('ok', 'bad', 'unsure')),
  note         TEXT,
  reviewer     TEXT        NOT NULL,
  reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_time
  ON analytics.reviews (reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_verdict
  ON analytics.reviews (verdict);


-- ------------------------------------------------------------
-- 5. case_records  Case 集
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.case_records (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         TEXT        NOT NULL REFERENCES analytics.agent_runs (request_id) ON DELETE CASCADE,
  title              TEXT        NOT NULL,
  category           TEXT,
  severity           TEXT        NOT NULL DEFAULT 'P2' CHECK (severity IN ('P0', 'P1', 'P2')),
  description        TEXT        NOT NULL,
  expected_behavior  TEXT,
  status             TEXT        NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'fixing', 'fixed', 'wontfix')),
  owner              TEXT,
  fix_version        TEXT,
  created_by         TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 一条执行只对应一个 Case
  CONSTRAINT one_case_per_request UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS idx_case_records_status
  ON analytics.case_records (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_records_category
  ON analytics.case_records (category);
CREATE INDEX IF NOT EXISTS idx_case_records_severity
  ON analytics.case_records (severity, status);


-- ------------------------------------------------------------
-- 6. 触发器：Case 建立时自动回写 agent_runs.review_verdict = 'bad'
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.sync_review_verdict()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'case_records' THEN
    UPDATE analytics.agent_runs
       SET review_verdict = 'bad'
     WHERE request_id = NEW.request_id;
  ELSIF TG_TABLE_NAME = 'reviews' THEN
    UPDATE analytics.agent_runs
       SET review_verdict = NEW.verdict
     WHERE request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_case_sync_review ON analytics.case_records;
CREATE TRIGGER trg_case_sync_review
  AFTER INSERT OR UPDATE OF request_id ON analytics.case_records
  FOR EACH ROW EXECUTE FUNCTION analytics.sync_review_verdict();

DROP TRIGGER IF EXISTS trg_review_sync ON analytics.reviews;
CREATE TRIGGER trg_review_sync
  AFTER INSERT OR UPDATE ON analytics.reviews
  FOR EACH ROW EXECUTE FUNCTION analytics.sync_review_verdict();

-- Case 删除时把 verdict 退回 unsure
CREATE OR REPLACE FUNCTION analytics.unsync_review_verdict()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE analytics.agent_runs SET review_verdict = 'unsure' WHERE request_id = OLD.request_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_case_unsync_review ON analytics.case_records;
CREATE TRIGGER trg_case_unsync_review
  AFTER DELETE ON analytics.case_records
  FOR EACH ROW EXECUTE FUNCTION analytics.unsync_review_verdict();


-- ------------------------------------------------------------
-- 7. case_records.updated_at 自动维护
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_case_touch ON analytics.case_records;
CREATE TRIGGER trg_case_touch
  BEFORE UPDATE ON analytics.case_records
  FOR EACH ROW EXECUTE FUNCTION analytics.touch_updated_at();


-- ------------------------------------------------------------
-- 8. 视图：把 event_logs 里尚未同步到 agent_runs 的状态兜住
--    正常情况下 agent_runs 已是真相源，此视图只做巡检
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_agent_run_detail AS
SELECT
  r.request_id,
  r.session_id,
  r.message_id,
  r.status,
  r.started_at,
  r.ended_at,
  r.duration_ms,
  r.model_version,
  r.prompt_version,
  r.error_code,
  r.error_message,
  r.original_request_id,
  r.is_auto_retry,
  r.last_feedback,
  r.feedback_updated_at,
  r.review_verdict,
  c.id            AS case_id,
  c.title         AS case_title,
  c.category      AS case_category,
  c.severity      AS case_severity,
  c.status        AS case_status,
  r.input_text,
  r.output_text
FROM analytics.agent_runs r
LEFT JOIN analytics.case_records c ON c.request_id = r.request_id;

COMMENT ON VIEW analytics.v_agent_run_detail IS '运行列表主查询视图，含 Case 关联';
