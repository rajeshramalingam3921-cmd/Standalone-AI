import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, type HealthResult } from './api';

type State = { kind: 'loading' } | HealthResult;

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const refresh = useCallback(() => {
    setState({ kind: 'loading' });
    void fetchHealth().then(setState);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((r) => {
      if (active) setState(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <header className="header">
        <h1>திறன் AI</h1>
        <p className="subtitle">Personal AI Development Platform</p>
      </header>

      <section className="card" aria-live="polite">
        <h2>Server நிலை</h2>
        {state.kind === 'loading' && <p className="badge badge-wait">சரிபார்க்கப்படுகிறது…</p>}
        {state.kind === 'ok' && (
          <>
            <p className="badge badge-ok">இயங்குகிறது</p>
            <dl className="meta">
              <dt>Version</dt>
              <dd>{state.data.version}</dd>
              <dt>Uptime</dt>
              <dd>{state.data.uptimeSeconds}s</dd>
            </dl>
          </>
        )}
        {state.kind === 'error' && <p className="badge badge-err">{state.message}</p>}
        <button type="button" className="button" onClick={refresh}>
          மீண்டும் சரிபார்
        </button>
      </section>

      <section className="card">
        <h2>அடுத்து வருபவை</h2>
        <p>Projects, Tasks, AI Chat ஆகியவை அடுத்த phase-களில் சேர்க்கப்படும்.</p>
      </section>
    </main>
  );
}
