#!/usr/bin/env node
/**
 * 造测试数据：让后台一上线就有东西看。
 * 用法：npm run db:seed
 *
 * 生成约 20 天、200 个会话的数据，包含成功/失败/超时/反馈/Case，
 * 少量会话能"有反馈但未评审"，用于验证文档 05.1 的坏例子率口径。
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://nuanyu:nuanyu_dev@localhost:5433/nuanyu_analytics';

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4'];
const PROMPTS = ['v1.0', 'v1.1', 'v1.2'];
const ERROR_CODES = ['TIMEOUT', 'UPSTREAM_ERROR', 'RATE_LIMIT', 'CONTEXT_OVERFLOW', 'TOOL_CALL_FAILED'];
const CATEGORIES = ['答非所问', '语气不当', '安全边界', '工具调用失败', '上下文丢失', '响应过慢'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const client = new Client({ connectionString: DB_URL });

async function main() {
  await client.connect();
  console.log('已连接，开始造数据…');

  // 清空历史假数据（保留手工录入的）
  await client.query(`TRUNCATE analytics.case_records, analytics.reviews, analytics.feedbacks, analytics.agent_runs, analytics.event_logs CASCADE`);

  const DAYS = 20;
  const SESSIONS_PER_DAY = 10;
  const now = Date.now();
  const casePool = [];

  for (let d = DAYS - 1; d >= 0; d--) {
    for (let s = 0; s < SESSIONS_PER_DAY; s++) {
      const sessionId = `s-${d}-${s}-${randomUUID().slice(0, 8)}`;
      // 每天活跃时段集中在 19:00-24:00
      const dayStart = now - d * 86400_000;
      // 注意：只允许向前偏移，不能晚于当前时间，否则会造出"未来数据"
      const sessionTime = new Date(
        Math.min(now - 60_000, dayStart - rand(0, 5) * 3600_000 + rand(0, 3600_000)),
      );

      // E01 session_start
      await client.query(
        `INSERT INTO analytics.event_logs
         (event_id,event_name,occurred_at,session_id,source,schema_version,properties)
         VALUES ($1,'session_start',$2,$3,'server',1,'{}')`,
        [randomUUID(), sessionTime, sessionId],
      );

      const msgCount = rand(1, 6);
      let sessionEnded = Math.random() > 0.2;

      for (let m = 0; m < msgCount; m++) {
        const messageId = `m-${sessionId}-${m}`;
        const msgTime = new Date(
          Math.min(now - 30_000, sessionTime.getTime() + m * rand(30_000, 180_000)),
        );

        // E02 message_send
        await client.query(
          `INSERT INTO analytics.event_logs
           (event_id,event_name,occurred_at,session_id,message_id,source,schema_version,properties)
           VALUES ($1,'message_send',$2,$3,$4,'server',1,$5)`,
          [randomUUID(), msgTime, sessionId, messageId, JSON.stringify({ message_length: rand(5, 120) })],
        );

        // 一条消息可能触发 1-2 次 Agent 执行（文档 02：区分消息数与执行次数）
        const runs = Math.random() > 0.85 ? 2 : 1;
        let lastRequestId = null;

        for (let r = 0; r < runs; r++) {
          const requestId = `r-${messageId}-${r}-${randomUUID().slice(0, 6)}`;
          const startTime = new Date(
            Math.min(now - 20_000, msgTime.getTime() + r * 3000 + rand(200, 900)),
          );

          // 结果分布：88% 成功 / 7% 报错 / 5% 超时
          const roll = Math.random();
          let status, durationMs, errorCode = null;
          if (roll < 0.88) {
            status = 'success';
            durationMs = rand(800, 9000);
          } else if (roll < 0.95) {
            status = 'error';
            durationMs = rand(300, 4000);
            errorCode = pick(ERROR_CODES.filter((c) => c !== 'TIMEOUT'));
          } else {
            status = 'timeout';
            durationMs = 600_000;
            errorCode = 'TIMEOUT';
          }

          const model = pick(MODELS);
          const prompt = pick(PROMPTS);

          // 结束时间也不能超过当前时间
          const endTime = new Date(
            Math.min(now - 1000, startTime.getTime() + durationMs),
          );
          const realDuration = Math.max(0, endTime.getTime() - startTime.getTime());

          await client.query(
            `INSERT INTO analytics.agent_runs
             (request_id,session_id,message_id,status,started_at,ended_at,duration_ms,
              model_version,prompt_version,error_code,original_request_id,is_auto_retry)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              requestId, sessionId, messageId, status, startTime,
              endTime, realDuration,
              model, prompt, errorCode,
              r > 0 ? lastRequestId : null,
              r > 0 && Math.random() > 0.5,
            ],
          );

          // 对应的 E03 + E04/E05 事件
          await client.query(
            `INSERT INTO analytics.event_logs
             (event_id,event_name,occurred_at,session_id,message_id,request_id,source,schema_version,properties)
             VALUES ($1,'agent_request_start',$2,$3,$4,$5,'server',1,$6)`,
            [randomUUID(), startTime, sessionId, messageId, requestId,
             JSON.stringify({ prompt_version: prompt })],
          );
          await client.query(
            `INSERT INTO analytics.event_logs
             (event_id,event_name,occurred_at,session_id,message_id,request_id,source,schema_version,properties)
             VALUES ($1,$2,$3,$4,$5,$6,'server',1,$7)`,
            [
              randomUUID(),
              status === 'success' ? 'agent_response' : 'agent_error',
              endTime,
              sessionId, messageId, requestId,
              JSON.stringify(
                status === 'success'
                  ? { duration_ms: realDuration, model_version: model, prompt_version: prompt }
                  : { error_code: errorCode, duration_ms: realDuration },
              ),
            ],
          );

          // E06 反馈：约 18% 有反馈，其中 40% 是负面
          const hasFeedback = Math.random() < 0.18;
          if (hasFeedback) {
            const value = Math.random() < 0.4 ? 'negative' : 'positive';
            const fbTime = new Date(
              Math.min(now - 500, endTime.getTime() + rand(2000, 30000)),
            );
            await client.query(
              `INSERT INTO analytics.event_logs
               (event_id,event_name,occurred_at,session_id,request_id,source,schema_version,properties)
               VALUES ($1,'feedback_submit',$2,$3,$4,'web',1,$5)`,
              [randomUUID(), fbTime, sessionId, requestId, JSON.stringify({ feedback_value: value })],
            );
            await client.query(
              `INSERT INTO analytics.feedbacks (request_id,session_id,value,created_at) VALUES ($1,$2,$3,$4)`,
              [requestId, sessionId, value, fbTime],
            );
            await client.query(
              `UPDATE analytics.agent_runs SET last_feedback=$2, feedback_updated_at=$3 WHERE request_id=$1`,
              [requestId, value, fbTime],
            );
            if (value === 'negative') casePool.push(requestId);
          }

          // 人工评审：约 12% 被看过。注意分母是"已评审"，不是"已入 Case"
          if (status !== 'running' && Math.random() < 0.12) {
            const isBad = Math.random() < 0.3;
            await client.query(
              `INSERT INTO analytics.reviews (request_id,verdict,note,reviewer,reviewed_at)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (request_id) DO NOTHING`,
              [
                requestId,
                isBad ? 'bad' : 'ok',
                isBad ? '回答偏离用户意图，未给出可执行建议' : '符合预期',
                '慧洁',
                new Date(Math.min(now - 1000, startTime.getTime() + 3600_000)),
              ],
            );
            if (isBad) casePool.push(requestId);
          }

          lastRequestId = requestId;
        }
      }

      // E08 session_end
      if (sessionEnded) {
        await client.query(
          `INSERT INTO analytics.event_logs
           (event_id,event_name,occurred_at,session_id,source,schema_version,properties)
           VALUES ($1,'session_end',$2,$3,'server',1,$4)`,
          [randomUUID(), new Date(Math.min(now - 500, sessionTime.getTime() + msgCount * 200_000)), sessionId,
           JSON.stringify({ end_reason: Math.random() > 0.3 ? 'explicit' : 'timeout' })],
        );
      }
    }
  }

  // 从候选中挑一批做成 Case 集
  const uniq = [...new Set(casePool)].slice(0, 14);
  for (const requestId of uniq) {
    await client.query(
      `INSERT INTO analytics.case_records
       (request_id,title,category,severity,description,expected_behavior,status,owner,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'慧洁')
       ON CONFLICT (request_id) DO NOTHING`,
      [
        requestId,
        pick([
          '用户说难过，AI 直接给建议没接住情绪',
          '重复追问后回答跑题',
          '工具调用失败但未告知用户',
          '回答中出现了不该出现的诊断性表述',
          '多轮对话后丢失前文关键信息',
          '响应超过 8 秒且无任何提示',
        ]),
        pick(CATEGORIES),
        pick(['P0', 'P1', 'P2']),
        '用户明确表达情绪低落，AI 未做情绪承接，直接给出「你应该多运动」类建议，语气偏指令。',
        '应先共情确认感受，再温和询问是否需要建议。',
        pick(['open', 'open', 'fixing', 'fixed']),
        pick(['阿杰', '小林', null]),
      ],
    );
  }

  // 统计
  const stats = await client.query(`
    SELECT
      (SELECT count(*) FROM analytics.event_logs)   AS events,
      (SELECT count(DISTINCT session_id) FROM analytics.event_logs) AS sessions,
      (SELECT count(*) FROM analytics.agent_runs)   AS runs,
      (SELECT count(*) FROM analytics.agent_runs WHERE status='success') AS success,
      (SELECT count(*) FROM analytics.agent_runs WHERE status<>'running') AS ended,
      (SELECT count(*) FROM analytics.reviews)      AS reviews,
      (SELECT count(*) FROM analytics.case_records) AS cases
  `);

  console.log('造数据完成：', stats.rows[0]);
  await client.end();
}

main().catch(async (err) => {
  console.error('失败：', err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
