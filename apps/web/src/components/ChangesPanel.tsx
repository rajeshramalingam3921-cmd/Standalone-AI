import { useState } from 'react';
import { CHANGE_STATUS_LABEL_TA, type ChangeSetStatus, type ChangeSetView } from '@thiran/shared';
import { api } from '../api';
import { href } from '../router';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';

const TONE: Record<ChangeSetStatus, string> = {
  pending: 'waiting',
  applied: 'done',
  rejected: 'muted',
  reverted: 'muted',
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('ta-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function ChangesPanel({ projectId, changeId }: { projectId: string; changeId?: string }) {
  return changeId ? (
    <ChangeDetail key={changeId} projectId={projectId} changeId={changeId} />
  ) : (
    <ChangeList projectId={projectId} />
  );
}

function ChangeList({ projectId }: { projectId: string }) {
  const [list] = useResource(`changes:${projectId}`, () => api.listChanges(projectId));
  if (list.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (list.state === 'error') return <ErrorBox message={list.message} />;
  if (list.data.length === 0) {
    return (
      <p className="muted empty">
        மாற்றப் பரிந்துரைகள் இல்லை. Files tab-இல் ஒரு file-ஐத் திருத்தி உருவாக்கலாம்.
      </p>
    );
  }
  return (
    <ul className="list" aria-label="Changes">
      {list.data.map((c) => (
        <li key={c.id}>
          <a
            className="card card-link"
            href={href({ name: 'project', projectId, tab: 'changes', changeId: c.id })}
          >
            <span className="task-head">
              <strong>{c.title}</strong>
              <span className={`badge tone-${TONE[c.status]}`}>
                {CHANGE_STATUS_LABEL_TA[c.status]}
              </span>
            </span>
            <small className="muted">
              {c.files.length} file(s) ·{' '}
              <span className="add">+{c.files.reduce((n, f) => n + f.additions, 0)}</span>{' '}
              <span className="del">−{c.files.reduce((n, f) => n + f.deletions, 0)}</span> ·{' '}
              {c.source === 'agent' ? 'AI' : 'நீங்கள்'} · {fmt(c.createdAt)}
            </small>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DiffView({ diff }: { diff: string }) {
  // Show hunks only: skip the "====", "---" and "+++" header lines.
  const all = diff.replace(/\n$/, '').split('\n');
  const start = all.findIndex((l) => l.startsWith('@@'));
  const lines = start >= 0 ? all.slice(start) : [];
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <span
          key={i}
          className={
            l.startsWith('+')
              ? 'diff-add'
              : l.startsWith('-')
                ? 'diff-del'
                : l.startsWith('@@')
                  ? 'diff-hunk'
                  : ''
          }
        >
          {l}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function ChangeDetail({ projectId, changeId }: { projectId: string; changeId: string }) {
  const [res, reload] = useResource(`change:${changeId}`, () => api.getChange(projectId, changeId));
  const [confirming, setConfirming] = useState<'apply' | 'revert'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; paths?: string[] }>();

  async function act(action: 'apply' | 'reject' | 'revert') {
    // Writing to disk needs a second, explicit tap.
    if ((action === 'apply' || action === 'revert') && confirming !== action)
      return setConfirming(action);
    setConfirming(undefined);
    setBusy(true);
    setError(undefined);
    const r = await api.changeAction(projectId, changeId, action);
    setBusy(false);
    if (!r.ok) return setError({ message: r.message, ...(r.paths && { paths: r.paths }) });
    await reload();
  }

  if (res.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (res.state === 'error') return <ErrorBox message={res.message} />;
  const c: ChangeSetView = res.data;

  return (
    <>
      <a className="back" href={href({ name: 'project', projectId, tab: 'changes' })}>
        ← மாற்றங்கள்
      </a>
      <section className="card">
        <div className="task-head">
          <h2 className="card-title">{c.title}</h2>
          <span className={`badge tone-${TONE[c.status]}`}>{CHANGE_STATUS_LABEL_TA[c.status]}</span>
        </div>
        <small className="muted">
          {c.source === 'agent' ? 'AI பரிந்துரை' : 'உங்கள் திருத்தம்'} · {fmt(c.createdAt)}
          {c.decidedAt && ` · முடிவு: ${fmt(c.decidedAt)}`}
        </small>
        {error && (
          <div className="error-box" role="alert">
            {error.message}
            {error.paths && (
              <ul>
                {error.paths.map((p) => (
                  <li key={p} className="mono">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="actions" style={{ marginTop: 12 }}>
          {c.status === 'pending' && (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void act('apply')}
              >
                {confirming === 'apply' ? 'உறுதியாக files-இல் எழுதவா?' : 'அனுமதித்து எழுது'}
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={busy}
                onClick={() => void act('reject')}
              >
                நிராகரி
              </button>
            </>
          )}
          {c.status === 'applied' && (
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() => void act('revert')}
            >
              {confirming === 'revert' ? 'உறுதியாகத் திரும்பப் பெறவா?' : 'திரும்பப் பெறு (rollback)'}
            </button>
          )}
          {confirming && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setConfirming(undefined)}
            >
              வேண்டாம்
            </button>
          )}
        </div>
      </section>

      {c.files.map((f) => (
        <section key={f.path} className="card">
          <div className="task-head">
            <strong className="mono">{f.path}</strong>
            <small>
              {f.action === 'create' ? 'புதியது · ' : ''}
              <span className="add">+{f.additions}</span>{' '}
              <span className="del">−{f.deletions}</span>
            </small>
          </div>
          <DiffView diff={f.diff} />
        </section>
      ))}
    </>
  );
}
