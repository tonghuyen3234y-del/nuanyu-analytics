'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  '答非所问',
  '情绪未承接',
  '语气不当',
  '安全边界',
  '工具调用失败',
  '上下文丢失',
  '响应过慢',
  '事实错误',
  '重复啰嗦',
  '其他',
];

const REVIEWER_KEY = 'nuanyu-reviewer';

export function ReviewPanel({
  requestId,
  currentVerdict,
  currentNote,
  currentReviewer,
}: {
  requestId: string;
  currentVerdict: string | null;
  currentNote: string | null;
  currentReviewer: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(currentNote ?? '');
  const [reviewer, setReviewer] = useState(
    currentReviewer ?? (typeof window !== 'undefined' ? localStorage.getItem(REVIEWER_KEY) : '') ?? '',
  );
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(verdict: 'ok' | 'bad' | 'unsure') {
    if (!reviewer.trim()) {
      setMsg('请先填写评审人');
      return;
    }
    localStorage.setItem(REVIEWER_KEY, reviewer.trim());
    const res = await fetch('/api/dashboard/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, verdict, note, reviewer: reviewer.trim() }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMsg(data.error ?? '提交失败');
      return;
    }
    setMsg(`已记录：${{ ok: '正常', bad: '坏例子', unsure: '待定' }[verdict]}`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 4px' }}>人工评审</h3>
      <p style={{ fontSize: 11.5, color: 'var(--quiet)', margin: '0 0 10px', lineHeight: 1.6 }}>
        评审为「正常」也要记，它构成坏例子率的分母
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          placeholder="评审人"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
        />
        <textarea
          rows={3}
          placeholder="评审备注（可选）：哪里不对、期望怎样"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn"
            disabled={pending || currentVerdict === 'ok'}
            onClick={() => submit('ok')}
            style={{ flex: 1 }}
          >
            ✓ 正常
          </button>
          <button
            className="btn"
            disabled={pending || currentVerdict === 'unsure'}
            onClick={() => submit('unsure')}
            style={{ flex: 1 }}
          >
            ? 待定
          </button>
        </div>
        {msg && (
          <div style={{ fontSize: 12, color: 'var(--sage)', marginTop: 2 }}>{msg}</div>
        )}
      </div>
    </div>
  );
}

export function CreateCasePanel({
  requestId,
  existingCaseId,
  existingCaseTitle,
}: {
  requestId: string;
  existingCaseId: string | null;
  existingCaseTitle: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    category: CATEGORIES[0],
    severity: 'P1',
    description: '',
    expected_behavior: '',
    owner: '',
  });

  if (existingCaseId) {
    return (
      <div
        className="card"
        style={{ padding: 14, background: '#fdf6f3', borderColor: '#efd8ce' }}
      >
        <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 6px', color: '#a33b28' }}>
          已在 Case 集中
        </h3>
        <p style={{ fontSize: 12.5, margin: '0 0 8px', lineHeight: 1.6 }}>{existingCaseTitle}</p>
        <a href="/cases" className="btn" style={{ display: 'inline-block' }}>
          去 Case 集查看 →
        </a>
      </div>
    );
  }

  async function submit() {
    if (!form.title.trim() || !form.description.trim()) {
      setMsg('标题和问题描述必填');
      return;
    }
    const reviewer =
      (typeof window !== 'undefined' && localStorage.getItem(REVIEWER_KEY)) || '未署名';
    const res = await fetch('/api/dashboard/cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        title: form.title,
        category: form.category,
        severity: form.severity,
        description: form.description,
        expected_behavior: form.expected_behavior || null,
        owner: form.owner || null,
        created_by: reviewer,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMsg(data.error ?? '创建失败');
      return;
    }
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button
        className="btn btn-primary"
        style={{ width: '100%', padding: '9px 0', fontSize: 13.5 }}
        onClick={() => setOpen(true)}
      >
        + 记为 Bad Case
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 14, borderColor: 'var(--clay)' }}>
      <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 10px' }}>新建 Bad Case</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          placeholder="标题，例：用户说难过，AI 直接给建议"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            style={{ flex: 1 }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
            style={{ width: 80 }}
          >
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
          </select>
        </div>
        <textarea
          rows={4}
          placeholder="实际发生了什么（必填）"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <textarea
          rows={3}
          placeholder="期望行为是什么（可选）"
          value={form.expected_behavior}
          onChange={(e) => setForm({ ...form, expected_behavior: e.target.value })}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <input
          type="text"
          placeholder="负责人（可选）"
          value={form.owner}
          onChange={(e) => setForm({ ...form, owner: e.target.value })}
        />
        {msg && <div style={{ fontSize: 12, color: '#a33b28' }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={pending}
            onClick={submit}
          >
            保存到 Case 集
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/** 展开/收起原文的工具按钮 */
export function RevealText({ text, label }: { text: string | null; label: string }) {
  const [shown, setShown] = useState(false);

  if (!text) {
    return (
      <div
        style={{
          fontSize: 12,
          color: '#a8a296',
          padding: '10px 12px',
          background: '#fbf9f5',
          borderRadius: 6,
          lineHeight: 1.6,
        }}
      >
        未存储（文档 A10：默认不落原文）
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.75,
          whiteSpace: 'pre-wrap',
          background: '#fbf9f5',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: 12,
          maxHeight: shown ? 420 : 90,
          overflow: 'hidden',
          position: 'relative',
          filter: shown ? 'none' : 'blur(0)',
        }}
      >
        {text}
      </div>
      <button
        className="btn"
        style={{ marginTop: 6, fontSize: 12 }}
        onClick={() => setShown(!shown)}
      >
        {shown ? '收起' : `展开${label}`}
      </button>
    </div>
  );
}
