'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// ============================================================
// 钻取抽屉：从漏斗某一步 / 留存某一格，看到具体是哪些用户
// 右滑出现，ESC 或点遮罩关闭，每行可跳现有复盘页
// ============================================================

export interface DrillRow {
  actor: string;
  session_id: string;
  last_event: string | null;
  last_at: string | null;
  events: number;
}

const EVENT_TEXT: Record<string, string> = {
  session_start: '进入会话',
  message_send: '发送消息',
  agent_request_start: '发起 AI 执行',
  agent_response: 'AI 正常返回',
  agent_error: 'AI 执行失败',
  feedback_submit: '提交反馈',
  retry_click: '点击重试',
  session_end: '结束会话',
};

export default function DrillDrawer({
  open,
  title,
  subtitle,
  rows,
  total,
  actorLabel,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle: React.ReactNode;
  rows: DrillRow[];
  total: number;
  actorLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(43,42,38,.16)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity .2s',
          zIndex: 70,
        }}
      />
      <aside
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: 'min(520px, 92vw)',
          background: '#fff',
          borderLeft: '1px solid var(--line)',
          boxShadow: '-10px 0 30px rgba(60,48,32,.10)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .26s cubic-bezier(.22,.9,.24,1)',
          zIndex: 71,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
              <div style={{ fontSize: 12, color: 'var(--quiet)', marginTop: 5, lineHeight: 1.65 }}>
                {subtitle}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn"
              style={{ padding: '2px 9px', fontSize: 12, flexShrink: 0 }}
              aria-label="关闭"
            >
              关闭
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {rows.length === 0 ? (
            <div style={{ padding: '44px 20px', textAlign: 'center', color: '#a09a8d', fontSize: 13 }}>
              无数据
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{actorLabel === '用户' ? '用户标识' : 'Session ID'}</th>
                  <th>最后一条事件</th>
                  <th>时间</th>
                  <th style={{ textAlign: 'right' }}>事件数</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.actor + r.session_id}>
                    <td className="mono" style={{ color: 'var(--quiet)', wordBreak: 'break-all' }}>
                      {r.actor.slice(0, 18)}
                      {r.actor.length > 18 ? '…' : ''}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{EVENT_TEXT[r.last_event ?? ''] ?? r.last_event ?? '—'}</td>
                    <td className="mono" style={{ color: 'var(--quiet)' }}>
                      {r.last_at ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--quiet)' }}>{r.events}</td>
                    <td>
                      <Link href={`/runs?q=${encodeURIComponent(r.session_id)}`} style={{ fontSize: 12 }}>
                        复盘 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer
          style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--line)',
            fontSize: 11.5,
            color: 'var(--quiet)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span>
            共 {total} 个{actorLabel}
            {total > rows.length ? `，显示最近 ${rows.length} 个` : ''}
          </span>

        </footer>
      </aside>
    </>
  );
}
