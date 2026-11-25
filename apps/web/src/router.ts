import { useEffect, useState } from 'react';

export type ProjectTab = 'chat' | 'files' | 'changes' | 'checks' | 'settings';

export type Route =
  | { name: 'dashboard' }
  | { name: 'new-project' }
  | {
      name: 'project';
      projectId: string;
      tab?: ProjectTab;
      conversationId?: string;
      changeId?: string;
      /** files tab: folder being browsed */
      dir?: string;
      /** files tab: file being viewed */
      file?: string;
    };

const UUID = /^[0-9a-fA-F-]{36}$/;
const TABS: ProjectTab[] = ['chat', 'files', 'changes', 'checks', 'settings'];

function decode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}

/** Hash routes keep the current screen across refreshes without server config. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/projects/new') return { name: 'new-project' };
  const m = /^\/projects\/([^/]+)(?:\/([a-z]+)(?:\/(.*))?)?$/.exec(path);
  if (!m || !UUID.test(m[1]!)) return { name: 'dashboard' };
  const projectId = m[1]!;
  const tab = m[2] as ProjectTab | undefined;
  const rest = m[3];
  if (!tab) return { name: 'project', projectId };
  if (!TABS.includes(tab)) return { name: 'dashboard' };
  if (rest === undefined) return { name: 'project', projectId, tab };

  if (tab === 'chat' && UUID.test(rest))
    return { name: 'project', projectId, tab, conversationId: rest };
  if (tab === 'changes' && UUID.test(rest))
    return { name: 'project', projectId, tab, changeId: rest };
  if (tab === 'files') {
    const fm = /^([df])\/(.+)$/.exec(rest);
    const p = fm && decode(fm[2]!);
    if (fm && p)
      return { name: 'project', projectId, tab, ...(fm[1] === 'd' ? { dir: p } : { file: p }) };
  }
  return { name: 'dashboard' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '#/';
    case 'new-project':
      return '#/projects/new';
    case 'project': {
      let h = `#/projects/${route.projectId}`;
      if (!route.tab) return h;
      h += `/${route.tab}`;
      if (route.conversationId) h += `/${route.conversationId}`;
      else if (route.changeId) h += `/${route.changeId}`;
      else if (route.file) h += `/f/${encodeURIComponent(route.file)}`;
      else if (route.dir) h += `/d/${encodeURIComponent(route.dir)}`;
      return h;
    }
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
