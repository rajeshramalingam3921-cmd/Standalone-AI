import { api } from '../api';
import { href } from '../router';
import { useResource } from '../useResource';
import { ErrorBox } from './FieldError';

export function SystemPage() {
  const [s] = useResource('system', () => api.systemStatus());
  if (s.state === 'loading') return <p className="muted">ஏற்றுகிறது…</p>;
  if (s.state === 'error') return <ErrorBox message={s.message} />;
  const d = s.data;
  const ok = (good: boolean) => (
    <span className={`badge tone-${good ? 'done' : 'waiting'}`}>{good ? 'சரி' : 'கவனிக்கவும்'}</span>
  );
  return (
    <>
      <a className="back" href={href({ name: 'dashboard' })}>
        ← Projects
      </a>
      <h2>System நிலை</h2>
      <section className="card">
        <dl className="meta system-meta">
          <dt>Version</dt>
          <dd>{d.version}</dd>
          <dt>தரவு சேமிப்பு</dt>
          <dd>
            {d.store === 'postgres' ? 'PostgreSQL' : 'JSON file'} {ok(d.store === 'postgres')}
          </dd>
          <dt>AI</dt>
          <dd>
            {d.aiProvider === 'mock' ? 'Mock (சோதனை)' : 'Claude API'}{' '}
            {ok(d.aiConfigured && d.aiProvider !== 'mock')}
          </dd>
          <dt>Workspace roots</dt>
          <dd>
            {d.workspaceRoots} {ok(d.workspaceRoots > 0)}
          </dd>
          <dt>கடைசி backup</dt>
          <dd>
            {d.lastBackupAt
              ? new Date(d.lastBackupAt).toLocaleString('ta-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : 'இல்லை'}{' '}
            {ok(!d.backupStale)}
          </dd>
        </dl>
      </section>
      {d.backupStale && (
        <section className="card notice" role="status">
          <strong>Backup தேவை</strong>
          <p>
            கடந்த 7 நாட்களில் backup இல்லை. Server கணினியில் <code>pnpm backup</code> ஓட்டி, உருவான file-ஐ
            வேறு disk அல்லது cloud-க்கு நகலெடுக்கவும்.
          </p>
        </section>
      )}
      <a className="card card-link" href={href({ name: 'audit' })}>
        <strong>செயல்பாட்டுப் பதிவு →</strong>
        <span className="muted">யார், எப்போது, என்ன செய்தார்கள்</span>
      </a>
    </>
  );
}
