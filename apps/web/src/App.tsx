import { useCallback, useEffect, useState } from 'react';
import { UNAUTHORIZED_EVENT, api } from './api';
import { Dashboard } from './components/Dashboard';
import { ErrorBox } from './components/FieldError';
import { HealthPill } from './components/HealthPill';
import { Login, SetupRequired } from './components/Login';
import { NewProject } from './components/NewProject';
import { ProjectView } from './components/ProjectView';
import { href, useRoute } from './router';

type Auth =
  | { state: 'checking' }
  | { state: 'setup' }
  | { state: 'signed-out' }
  | { state: 'signed-in' }
  | { state: 'error'; message: string };

export function App() {
  const route = useRoute();
  const [auth, setAuth] = useState<Auth>({ state: 'checking' });

  const check = useCallback(async () => {
    const r = await api.session();
    if (!r.ok) return setAuth({ state: 'error', message: r.message });
    setAuth({
      state: r.data.setupRequired ? 'setup' : r.data.authenticated ? 'signed-in' : 'signed-out',
    });
  }, []);

  useEffect(() => {
    let active = true;
    void api.session().then((r) => {
      if (!active) return;
      if (!r.ok) return setAuth({ state: 'error', message: r.message });
      setAuth({
        state: r.data.setupRequired ? 'setup' : r.data.authenticated ? 'signed-in' : 'signed-out',
      });
    });
    // Any 401 (expired session, signed out elsewhere) returns to the login screen.
    const onUnauthorized = () => setAuth({ state: 'signed-out' });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  async function logout() {
    await api.logout();
    setAuth({ state: 'signed-out' });
  }

  return (
    <div className="shell">
      <header className="header">
        <a className="brand" href={href({ name: 'dashboard' })}>
          திறன் AI
        </a>
        <div className="header-right">
          <HealthPill />
          {auth.state === 'signed-in' && (
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => void logout()}
            >
              வெளியேறு
            </button>
          )}
        </div>
      </header>
      <main>
        {auth.state === 'checking' && <p className="muted">சரிபார்க்கிறது…</p>}
        {auth.state === 'error' && (
          <>
            <ErrorBox message={auth.message} />
            <button type="button" className="button button-ghost" onClick={() => void check()}>
              மீண்டும் முயற்சி செய்
            </button>
          </>
        )}
        {auth.state === 'setup' && <SetupRequired onRetry={() => void check()} />}
        {auth.state === 'signed-out' && (
          <Login onSignedIn={() => setAuth({ state: 'signed-in' })} />
        )}
        {auth.state === 'signed-in' && (
          <>
            {route.name === 'dashboard' && <Dashboard />}
            {route.name === 'new-project' && <NewProject />}
            {route.name === 'project' && (
              <ProjectView key={route.projectId} projectId={route.projectId} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
