import { useEffect, useState } from 'react';

export type Route =
  { name: 'dashboard' } | { name: 'new-project' } | { name: 'project'; projectId: string };

/** Hash routes keep the current screen across refreshes without server config. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/projects/new') return { name: 'new-project' };
  const m = /^\/projects\/([0-9a-fA-F-]{36})$/.exec(path);
  if (m?.[1]) return { name: 'project', projectId: m[1] };
  return { name: 'dashboard' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '#/';
    case 'new-project':
      return '#/projects/new';
    case 'project':
      return `#/projects/${route.projectId}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
