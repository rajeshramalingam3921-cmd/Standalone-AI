import { TASK_STATUS_GROUP_LABEL_TA, type TaskStatusGroup } from '@thiran/shared';
import { api } from '../api';
import { href } from '../router';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';

const GROUPS: TaskStatusGroup[] = ['waiting', 'running', 'failed', 'done'];

export function Dashboard() {
  const [projects, reload] = useResource('projects', () => api.listProjects());

  return (
    <>
      <div className="section-head">
        <h2>Projects</h2>
        <a className="button button-small" href={href({ name: 'new-project' })}>
          + புதிய project
        </a>
      </div>

      {projects.state === 'loading' && <p className="muted">ஏற்றுகிறது…</p>}
      {projects.state === 'error' && (
        <>
          <ErrorBox message={projects.message} />
          <button type="button" className="button button-ghost" onClick={() => void reload()}>
            மீண்டும் முயற்சி செய்
          </button>
        </>
      )}
      {projects.state === 'ready' && projects.data.length === 0 && (
        <div className="card empty">
          <p>இன்னும் project எதுவும் இல்லை.</p>
          <p className="muted">முதல் project-ஐ உருவாக்கத் தொடங்குங்கள்.</p>
        </div>
      )}
      {projects.state === 'ready' && projects.data.length > 0 && (
        <ul className="list" aria-label="Projects">
          {projects.data.map((p) => (
            <li key={p.id}>
              <a className="card card-link" href={href({ name: 'project', projectId: p.id })}>
                <strong className="card-title">{p.name}</strong>
                {p.description && <span className="muted clamp">{p.description}</span>}
                {p.techStack.length > 0 && (
                  <span className="chips">
                    {p.techStack.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                <span className="counts">
                  {GROUPS.map((g) => (
                    <span key={g} className={`count tone-${g}`}>
                      {TASK_STATUS_GROUP_LABEL_TA[g]} {p.taskCounts[g]}
                    </span>
                  ))}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
