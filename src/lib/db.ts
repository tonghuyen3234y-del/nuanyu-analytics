import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// ============================================================
// Postgres 连接
// 本地：docker compose 起的 5433 端口
// 生产：把 DATABASE_URL 换成 Supabase / 自建库连接串即可
// ============================================================

declare global {
  // eslint-disable-next-line no-var
  var __nuanyuPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://nuanyu:nuanyu_dev@localhost:5433/nuanyu_analytics';

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[db] 连接池异常', err.message);
  });

  return pool;
}

export const pool: Pool = global.__nuanyuPool ?? createPool();
if (process.env.NODE_ENV !== 'production') {
  global.__nuanyuPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 是否允许存储聊天原文。文档 A10：默认关闭 */
export const PII_STORAGE_ENABLED = process.env.ENABLE_PII_STORAGE === 'true';

/** 埋点接口鉴权 key */
export const TRACKER_API_KEY = process.env.TRACKER_API_KEY ?? 'dev-tracker-key';

/** 后台页面访问口令。为空则不校验（本地开发） */
export const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? '';

/** running 超过多久视为超时（毫秒），文档 03.1 要求兜底 */
export const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 10 * 60 * 1000);
