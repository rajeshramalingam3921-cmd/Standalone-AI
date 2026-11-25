import { Dashboard } from './components/Dashboard';
import { HealthPill } from './components/HealthPill';
import { NewProject } from './components/NewProject';
import { ProjectView } from './components/ProjectView';
import { href, useRoute } from './router';

export function App() {
  const route = useRoute();
  return (
    <div className="shell">
      <header className="header">
        <a className="brand" href={href({ name: 'dashboard' })}>
          திறன் AI
        </a>
        <HealthPill />
      </header>
      <main>
        {route.name === 'dashboard' && <Dashboard />}
        {route.name === 'new-project' && <NewProject />}
        {route.name === 'project' && (
          <ProjectView key={route.projectId} projectId={route.projectId} />
        )}
      </main>
    </div>
  );
}
