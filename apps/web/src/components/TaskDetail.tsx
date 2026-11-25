import { useEffect, useState } from 'react';
import {
  AGENT_PHASE_LABEL_TA,
  RUN_STATUS_LABEL_TA,
  USER_TASK_ACTION_LABEL_TA,
  availableUserActions,
  type Task,
  type UserTaskAction,
} from '@thiran/shared';
import { api } from '../api';
import { href } from '../router';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';
import { StatusBadge } from './StatusBadge';

const ACTIVE = new Set(['planning', 'executing', 'verifying']);

/** Very small Markdown subset for the server-built report: headings, lists, bold, code. Text only. */
export function ReportView({ text }: { text: string }) {
  return (
    <div className="report">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('# ')) return <h3 key={i}>{line.slice(2)}</h3>;
        if (line.startsWith('## ')) return <h4 key={i}>{line.slice(3)}</h4>;
        if (line.trim() === '') return <div key={i} className="gap" />;
        if (/^_.*_$/.test(line))
          return (
            <small key={i} className="muted">
              {line.slice(1, -1)}
            </small>
          );
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) =>
          p.startsWith('**') ? (
            <strong key={j}>{p.slice(2, -2)}</strong>
          ) : p.startsWith('`') ? (
            <code key={j} className="mono">
              {p.slice(1, -1)}
            </code>
          ) : (
            p
          ),
        );
        return <p key={i}>{parts}</p>;
      })}
    </div>
  );
}

export function TaskDetail({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [res, reload] = useResource(`task:${taskId}`, async () => {
    const r = await api.listTasks(projectId);
    if (!r.ok) return r;
    const t = r.data.find((x) => x.id === taskId);
    return t
      ? { ok: true as const, data: t }
      : { ok: false as const, status: 404, message: 'Task கிடைக்கவில்லை' };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const task: Task | undefined = res.state === 'ready' ? res.data : undefined;
  const active = !!task?.agent && ACTIVE.has(task.agent.phase);

  // Live updates while the agent is working.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void reload(), 1500);
    return () => clearInterval(t);
  }, [active, reload]);

  async function act(action: UserTaskAction) {
    if (action === 'cancel' && !confirmCancel) return setConfirmCancel(true);
    if (action === 'request_changes' && !showFeedback) return setShowFeedback(true);
    setConfirmCancel(false);
    setBusy(true);
    setError(undefined);
    const r = await api.taskAction(
      projectId,
      taskId,
      action,
      action === 'request_changes' ? feedback : undefined,
    );
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setShowFeedback(false);
    setFeedback('');
    await reload();
  }

  if (res.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (res.state === 'error') return <ErrorBox message={res.message} />;
  const t = res.data;
  const a = t.agent;
  const actions = availableUserActions(t.status);

  return (
    <>
      <a className="back" href={href({ name: 'project', projectId })}>
        ← Tasks
      </a>
      <section className="card">
        <div className="task-head">
          <h2 className="card-title">{t.title}</h2>
          <StatusBadge status={t.status} />
        </div>
        {t.description && <p className="pre muted">{t.description}</p>}
        {a && (
          <p className={`agent-phase ${active ? 'agent-active' : ''}`} aria-live="polite">
            {active && <span className="spinner" aria-hidden="true" />}
            {AGENT_PHASE_LABEL_TA[a.phase]} · முயற்சி {a.attempts} · திட்டம் {a.plans}
          </p>
        )}
        <ErrorBox message={error} />
        {showFeedback && (
          <label className="form">
            AI-க்கு உங்கள் கருத்து (எதை மாற்ற வேண்டும்?)
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </label>
        )}
        {actions.length > 0 && (
          <div className="actions" style={{ marginTop: 8 }}>
            {actions.map((x) => (
              <button
                key={x}
                type="button"
                className={`button button-small ${x === 'cancel' ? 'button-danger' : x === 'request_changes' ? 'button-ghost' : ''}`}
                disabled={busy || (x === 'request_changes' && showFeedback && !feedback.trim())}
                onClick={() => void act(x)}
              >
                {x === 'cancel' && confirmCancel
                  ? 'உறுதியாக ரத்து செய்?'
                  : x === 'request_changes' && showFeedback
                    ? 'கருத்தை அனுப்பு'
                    : USER_TASK_ACTION_LABEL_TA[x]}
              </button>
            ))}
          </div>
        )}
      </section>

      {a?.plan && (
        <section className="card">
          <h3>AI திட்டம்</h3>
          <p className="pre">{a.plan.summary}</p>
          <ol>
            {a.plan.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {a.plan.files.length > 0 && (
            <p>
              <strong>Files:</strong>{' '}
              {a.plan.files.map((f) => (
                <code key={f} className="mono chip">
                  {f}
                </code>
              ))}
            </p>
          )}
          <p>
            <strong>சோதனைகள்:</strong> {a.plan.checks.length ? a.plan.checks.join(', ') : 'இல்லை'}
          </p>
        </section>
      )}

      {a?.changeSetId && a.phase === 'awaiting_diff' && (
        <a
          className="card card-link notice"
          href={href({ name: 'project', projectId, tab: 'changes', changeId: a.changeSetId })}
        >
          <strong>AI பரிந்துரைத்த மாற்றங்கள் தயார்</strong>
          <span>diff-ஐப் பார்த்து அனுமதிக்கவும் அல்லது நிராகரிக்கவும் →</span>
        </a>
      )}

      {a && a.checks.length > 0 && (
        <section className="card">
          <h3>சோதனை முடிவுகள்</h3>
          <ul>
            {a.checks.map((c) => (
              <li key={c.runId}>
                {c.name}: {RUN_STATUS_LABEL_TA[c.status]}
                {c.exitCode !== null && ` (exit ${c.exitCode})`}
              </li>
            ))}
          </ul>
          <a href={href({ name: 'project', projectId, tab: 'checks' })}>முழு output →</a>
        </section>
      )}

      {a?.report && (
        <section className="card" aria-label="அறிக்கை">
          <ReportView text={a.report} />
        </section>
      )}

      {a && a.activity.length > 0 && (
        <details className="card" open={active}>
          <summary>
            <strong>செயல்பாட்டுப் பதிவு</strong> ({a.activity.length})
          </summary>
          <ol className="activity">
            {a.activity.slice(-60).map((x, i) => (
              <li key={i} className={`activity-${x.kind}`}>
                <small className="muted">{new Date(x.at).toLocaleTimeString('ta-IN')}</small>{' '}
                {x.text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
