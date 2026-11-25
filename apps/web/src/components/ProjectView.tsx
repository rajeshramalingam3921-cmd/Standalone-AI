import { useState, type FormEvent } from 'react';
import {
  TASK_STATUS_GROUP_LABEL_TA,
  USER_TASK_ACTION_LABEL_TA,
  availableUserActions,
  taskStatusGroup,
  type Task,
  type TaskStatusGroup,
  type UserTaskAction,
} from '@thiran/shared';
import { api } from '../api';
import { href, type ProjectTab, type Route } from '../router';
import { useDraft } from '../useDraft';
import { useResource } from '../useResource';
import { ChangesPanel } from './ChangesPanel';
import { ChatPanel } from './Chat';
import { ChecksPanel } from './ChecksPanel';
import { FilesPanel } from './FilesPanel';
import { SettingsPanel } from './SettingsPanel';
import { ErrorBox, fieldError } from './FieldError';
import { StatusBadge } from './StatusBadge';

type Filter = 'all' | TaskStatusGroup;
const FILTERS: Filter[] = ['all', 'waiting', 'running', 'failed', 'done'];
const FILTER_LABEL: Record<Filter, string> = { all: 'அனைத்தும்', ...TASK_STATUS_GROUP_LABEL_TA };

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('ta-IN', { dateStyle: 'medium', timeStyle: 'short' });

const TAB_LABELS: [ProjectTab | undefined, string][] = [
  [undefined, 'Tasks'],
  ['chat', 'AI Chat'],
  ['files', 'Files'],
  ['changes', 'மாற்றங்கள்'],
  ['checks', 'சோதனைகள்'],
  ['settings', 'Settings'],
];

export function ProjectView({ route }: { route: Extract<Route, { name: 'project' }> }) {
  const { projectId, tab } = route;
  const [project, reloadProject] = useResource(`project:${projectId}`, () =>
    api.getProject(projectId),
  );
  const [tasks, reloadTasks] = useResource(`tasks:${projectId}`, () => api.listTasks(projectId));
  const [filter, setFilter] = useState<Filter>('all');

  if (project.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (project.state === 'error') {
    return (
      <>
        <a className="back" href={href({ name: 'dashboard' })}>
          ← Projects
        </a>
        <ErrorBox message={`Project: ${project.message}`} />
      </>
    );
  }

  const p = project.data;
  const all = tasks.state === 'ready' ? tasks.data : [];
  const count = (f: Filter) =>
    f === 'all' ? all.length : all.filter((t) => taskStatusGroup(t.status) === f).length;
  const visible = filter === 'all' ? all : all.filter((t) => taskStatusGroup(t.status) === filter);

  return (
    <>
      <a className="back" href={href({ name: 'dashboard' })}>
        ← Projects
      </a>
      <section className="card">
        <h2 className="card-title">{p.name}</h2>
        {p.description && <p className="pre">{p.description}</p>}
        <dl className="meta">
          {p.techStack.length > 0 && (
            <>
              <dt>Stack</dt>
              <dd>{p.techStack.join(', ')}</dd>
            </>
          )}
          {p.workspacePath && (
            <>
              <dt>Path</dt>
              <dd className="mono">{p.workspacePath}</dd>
            </>
          )}
          <dt>உருவாக்கம்</dt>
          <dd>{formatTime(p.createdAt)}</dd>
        </dl>
      </section>

      <nav className="tabs tabs-main" aria-label="Project sections">
        {TAB_LABELS.map(([t, label]) => (
          <a
            key={label}
            className={`tab ${tab === t ? 'tab-active' : ''}`}
            href={href({ name: 'project', projectId, ...(t && { tab: t }) })}
            aria-current={tab === t ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      {tab === 'chat' ? (
        <ChatPanel
          projectId={projectId}
          {...(route.conversationId && { conversationId: route.conversationId })}
        />
      ) : tab === 'files' ? (
        <FilesPanel
          projectId={projectId}
          {...(route.dir !== undefined && { dir: route.dir })}
          {...(route.file !== undefined && { file: route.file })}
        />
      ) : tab === 'changes' ? (
        <ChangesPanel projectId={projectId} {...(route.changeId && { changeId: route.changeId })} />
      ) : tab === 'checks' ? (
        <ChecksPanel projectId={projectId} />
      ) : tab === 'settings' ? (
        <SettingsPanel project={p} onSaved={() => void reloadProject()} />
      ) : (
        <>
          <NewTaskForm projectId={projectId} onCreated={() => void reloadTasks()} />

          <div className="section-head">
            <h2>Tasks</h2>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => void reloadTasks()}
            >
              புதுப்பி
            </button>
          </div>

          <div className="tabs" role="tablist" aria-label="Task filter">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`tab ${filter === f ? 'tab-active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]} ({count(f)})
              </button>
            ))}
          </div>

          {tasks.state === 'loading' && <p className="muted">ஏற்றுகிறது…</p>}
          {tasks.state === 'error' && <ErrorBox message={tasks.message} />}
          {tasks.state === 'ready' && visible.length === 0 && (
            <p className="muted empty">இந்தப் பிரிவில் task எதுவும் இல்லை.</p>
          )}
          <ul className="list" aria-label="Tasks">
            {visible.map((t) => (
              <TaskItem key={t.id} task={t} onChanged={() => void reloadTasks()} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function NewTaskForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [form, setForm, clearDraft] = useDraft(`new-task:${projectId}`, {
    title: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    issues?: { path: string; message: string }[];
  }>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFailure(undefined);
    const r = await api.createTask(projectId, form);
    setSubmitting(false);
    if (!r.ok) return setFailure(r);
    clearDraft();
    onCreated();
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate aria-label="புதிய task">
      <h3>புதிய task</h3>
      <ErrorBox message={failure?.message} />
      <label>
        தலைப்பு *
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          maxLength={200}
          placeholder="எ.கா: Login page உருவாக்கு"
        />
        <ErrorBox message={fieldError(failure?.issues, 'title')} />
      </label>
      <label>
        விவரம்
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={3}
          maxLength={10_000}
        />
      </label>
      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'சேர்க்கிறது…' : 'Task சேர்'}
      </button>
    </form>
  );
}

export function TaskItem({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [pending, setPending] = useState<UserTaskAction>();
  const [confirming, setConfirming] = useState<UserTaskAction>();
  const [error, setError] = useState<string>();
  const actions = availableUserActions(task.status);

  async function run(action: UserTaskAction) {
    // Cancelling is irreversible, so it needs a second tap to confirm.
    if (action === 'cancel' && confirming !== 'cancel') return setConfirming('cancel');
    setConfirming(undefined);
    setPending(action);
    setError(undefined);
    const r = await api.taskAction(task.projectId, task.id, action);
    setPending(undefined);
    if (!r.ok) return setError(r.message);
    onChanged();
  }

  return (
    <li className="card task">
      <div className="task-head">
        <strong>{task.title}</strong>
        <StatusBadge status={task.status} />
      </div>
      {task.description && <p className="pre muted">{task.description}</p>}
      <small className="muted">புதுப்பிப்பு: {formatTime(task.updatedAt)}</small>
      <ErrorBox message={error} />
      {actions.length > 0 && (
        <div className="actions">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`button button-small ${a === 'cancel' ? 'button-danger' : ''}`}
              disabled={pending !== undefined}
              onClick={() => void run(a)}
            >
              {confirming === a ? 'உறுதியாக ரத்து செய்?' : USER_TASK_ACTION_LABEL_TA[a]}
            </button>
          ))}
          {confirming && (
            <button
              type="button"
              className="button button-small button-ghost"
              onClick={() => setConfirming(undefined)}
            >
              வேண்டாம்
            </button>
          )}
        </div>
      )}
    </li>
  );
}
