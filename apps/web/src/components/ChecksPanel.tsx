import { useEffect, useState } from 'react';
import {
  COMMAND_NAMES,
  RUN_STATUS_LABEL_TA,
  type CommandName,
  type CommandRunStatus,
} from '@thiran/shared';
import { api } from '../api';
import { href } from '../router';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';
import { WorkspaceNotice } from './WorkspaceNotice';

const TONE: Record<CommandRunStatus, string> = {
  running: 'running',
  passed: 'done',
  failed: 'failed',
  timeout: 'failed',
  error: 'failed',
};

const duration = (a: string, b: string | null) =>
  b ? `${Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))}s` : '';

export function ChecksPanel({ projectId }: { projectId: string }) {
  const [ws] = useResource(`ws:${projectId}`, () => api.workspace(projectId));
  const [runs, reload] = useResource(`runs:${projectId}`, () => api.listRuns(projectId));
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState<CommandName>();
  const anyRunning = runs.state === 'ready' && runs.data.some((r) => r.status === 'running');

  // Poll while something is running.
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => void reload(), 1000);
    return () => clearInterval(t);
  }, [anyRunning, reload]);

  async function start(name: CommandName) {
    setStarting(name);
    setError(undefined);
    const r = await api.startRun(projectId, name);
    setStarting(undefined);
    if (!r.ok) return setError(r.message);
    await reload();
  }

  if (ws.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (ws.state === 'error') return <ErrorBox message={ws.message} />;
  if (ws.data.state !== 'ok')
    return <WorkspaceNotice projectId={projectId} state={ws.data.state} />;
  const commands = ws.data.commands;
  const configured = COMMAND_NAMES.filter((n) => commands[n]);

  return (
    <>
      <section className="card">
        <h3>சோதனைகள்</h3>
        {configured.length === 0 && (
          <p className="muted">
            Command எதுவும் அமைக்கப்படவில்லை.{' '}
            <a href={href({ name: 'project', projectId, tab: 'settings' })}>Settings-இல் அமைக்கவும்</a>
            .
          </p>
        )}
        <ErrorBox message={error} />
        <ul className="list">
          {configured.map((n) => (
            <li key={n} className="cmd-row">
              <span>
                <strong>{n}</strong> <code className="mono muted">{commands[n]!.join(' ')}</code>
              </span>
              <button
                type="button"
                className="button button-small"
                disabled={anyRunning || starting !== undefined}
                onClick={() => void start(n)}
              >
                ஓட்டு
              </button>
            </li>
          ))}
        </ul>
      </section>

      <h3>சமீபத்திய ஓட்டங்கள்</h3>
      {runs.state === 'error' && <ErrorBox message={runs.message} />}
      {runs.state === 'ready' && runs.data.length === 0 && <p className="muted">இன்னும் இல்லை.</p>}
      <ul className="list" aria-label="Runs">
        {runs.state === 'ready' &&
          runs.data.map((r) => (
            <li key={r.id} className="card task" data-status={r.status}>
              <div className="task-head">
                <strong>{r.name}</strong>
                <span className={`badge tone-${TONE[r.status]}`}>
                  {RUN_STATUS_LABEL_TA[r.status]}
                </span>
              </div>
              <small className="muted">
                {new Date(r.startedAt).toLocaleString('ta-IN', {
                  timeStyle: 'short',
                  dateStyle: 'medium',
                })}
                {r.exitCode !== null && ` · exit ${r.exitCode}`}{' '}
                {duration(r.startedAt, r.finishedAt)}
              </small>
              <details open={r.status !== 'passed' && r.status !== 'running'}>
                <summary>Output</summary>
                <pre className="file-view">{r.output || '(output இல்லை)'}</pre>
              </details>
            </li>
          ))}
      </ul>
    </>
  );
}
