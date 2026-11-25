import { useState } from 'react';
import {
  AUDIT_ACTION_LABEL_TA,
  AUDIT_ACTOR_LABEL_TA,
  type AuditDetail,
  type AuditEvent,
} from '@thiran/shared';
import { api } from '../api';
import { href } from '../router';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';

const ACTOR_ICON = { owner: '👤', agent: '🤖', system: '⚙️' } as const;

/** One readable line of the most useful detail fields. Values are shown as text only. */
export function detailLine(d: AuditDetail): string {
  const keys = [
    'title',
    'name',
    'action',
    'from',
    'to',
    'status',
    'exitCode',
    'outcome',
    'reason',
    'paths',
    'fields',
    'files',
    'file',
    'ip',
  ];
  return keys
    .filter((k) => d[k] !== undefined && d[k] !== null)
    .map((k) => {
      const v = d[k];
      return `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`;
    })
    .join(' · ');
}

export function AuditPage({ projectId }: { projectId?: string }) {
  const [first] = useResource(`audit:${projectId ?? 'all'}`, () =>
    api.audit({ ...(projectId && { projectId }) }),
  );
  const [more, setMore] = useState<AuditEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  const events = first.state === 'ready' ? [...first.data, ...more] : [];

  async function loadMore() {
    const last = events.at(-1);
    if (!last) return;
    setLoadingMore(true);
    const r = await api.audit({ ...(projectId && { projectId }), before: last.at });
    setLoadingMore(false);
    if (!r.ok) return setError(r.message);
    if (r.data.length === 0) setDone(true);
    setMore((m) => [...m, ...r.data]);
  }

  return (
    <>
      <a
        className="back"
        href={
          projectId
            ? href({ name: 'project', projectId, tab: 'settings' })
            : href({ name: 'dashboard' })
        }
      >
        ← {projectId ? 'Project' : 'Projects'}
      </a>
      <h2>செயல்பாட்டுப் பதிவு {projectId && '(இந்த project)'}</h2>
      <p className="muted">
        உள்நுழைவுகள், அனுமதிகள், file மாற்றங்கள், commands, AI செயல்கள் — அனைத்தும் இங்கே பதிவாகும். இந்தப் பதிவை
        மாற்றவோ நீக்கவோ முடியாது. File உள்ளடக்கமோ கடவுச்சொல்லோ இங்கே சேமிக்கப்படுவதில்லை.
      </p>
      {first.state === 'loading' && <p className="muted">ஏற்றுகிறது…</p>}
      {first.state === 'error' && <ErrorBox message={first.message} />}
      <ol className="audit-list" aria-label="Audit events">
        {events.map((e) => (
          <li key={e.id} className={`audit-item audit-${e.actor}`}>
            <div className="task-head">
              <strong>
                <span aria-hidden="true">{ACTOR_ICON[e.actor]}</span>{' '}
                {AUDIT_ACTION_LABEL_TA[e.action]}
              </strong>
              <small className="muted">
                {new Date(e.at).toLocaleString('ta-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'medium',
                })}
              </small>
            </div>
            <small className="muted">
              {AUDIT_ACTOR_LABEL_TA[e.actor]}
              {detailLine(e.detail) && ` · ${detailLine(e.detail)}`}
            </small>
          </li>
        ))}
      </ol>
      {first.state === 'ready' && events.length === 0 && (
        <p className="muted empty">இன்னும் பதிவு இல்லை.</p>
      )}
      <ErrorBox message={error} />
      {first.state === 'ready' && events.length >= 50 && !done && (
        <button
          type="button"
          className="button button-ghost"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? 'ஏற்றுகிறது…' : 'மேலும் காட்டு'}
        </button>
      )}
    </>
  );
}
