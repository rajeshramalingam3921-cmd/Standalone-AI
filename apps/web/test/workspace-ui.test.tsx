// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeSetView } from '@thiran/shared';
import { ChangesPanel, DiffView } from '../src/components/ChangesPanel';
import { FilesPanel } from '../src/components/FilesPanel';
import { splitArgs } from '../src/components/SettingsPanel';
import { href, parseRoute, type Route } from '../src/router';

const P = '11111111-1111-4111-8111-111111111111';
const CID = '33333333-3333-4333-8333-333333333333';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('router (files, changes, settings)', () => {
  it('round-trips every project tab, including nested and Tamil file paths', () => {
    const routes: Route[] = [
      { name: 'project', projectId: P, tab: 'files' },
      { name: 'project', projectId: P, tab: 'files', dir: 'src/pages' },
      { name: 'project', projectId: P, tab: 'files', file: 'docs/கணக்கு.md' },
      { name: 'project', projectId: P, tab: 'changes', changeId: CID },
      { name: 'project', projectId: P, tab: 'checks' },
      { name: 'project', projectId: P, tab: 'settings' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
  it('falls back to the dashboard for malformed input', () => {
    expect(parseRoute(`#/projects/${P}/files/f/%E0%A4`)).toEqual({ name: 'dashboard' });
    expect(parseRoute(`#/projects/${P}/admin`)).toEqual({ name: 'dashboard' });
    expect(parseRoute(`#/projects/${P}/changes/not-a-uuid`)).toEqual({ name: 'dashboard' });
  });
});

describe('splitArgs', () => {
  it('splits on whitespace without any shell interpretation', () => {
    expect(splitArgs('  pnpm   test --run ')).toEqual(['pnpm', 'test', '--run']);
    expect(splitArgs('a && b')).toEqual(['a', '&&', 'b']);
  });
});

describe('DiffView', () => {
  it('colours added, removed and hunk lines, and hides the file header', () => {
    // Exact shape produced by the diff library on the server.
    const diff =
      '===================================================================\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n';
    const { container } = render(<DiffView diff={diff} />);
    expect(container.textContent).not.toContain('+++');
    expect(container.textContent).not.toContain('===');
    expect(container.querySelectorAll('.diff-add')).toHaveLength(1);
    expect(container.querySelectorAll('.diff-del')).toHaveLength(1);
    expect(container.querySelector('.diff-del')?.textContent).toBe('-old\n');
    expect(container.querySelector('.diff-add')?.textContent).toBe('+new\n');
    expect(container.querySelector('.diff-hunk')?.textContent).toContain('@@');
  });
});

const pending: ChangeSetView = {
  id: CID,
  projectId: P,
  title: 'திருத்தம்: src/app.ts',
  source: 'user',
  status: 'pending',
  files: [
    {
      path: 'src/app.ts',
      action: 'modify',
      diff: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n',
      additions: 1,
      deletions: 1,
    },
  ],
  createdAt: '2026-11-25T00:00:00.000Z',
  decidedAt: null,
};

describe('ChangesPanel', () => {
  it('needs two taps before writing to disk, then calls apply exactly once', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(url);
          return json({ ...pending, status: 'applied', decidedAt: '2026-11-25T00:01:00.000Z' });
        }
        return json(calls.length ? { ...pending, status: 'applied' } : pending);
      }),
    );
    render(<ChangesPanel projectId={P} changeId={CID} />);
    await userEvent.click(await screen.findByText('அனுமதித்து எழுது'));
    expect(calls).toEqual([]);
    await userEvent.click(screen.getByText('உறுதியாக files-இல் எழுதவா?'));
    await waitFor(() => expect(calls).toEqual([`/api/projects/${P}/changes/${CID}/apply`]));
    expect(await screen.findByText('பயன்படுத்தப்பட்டது')).toBeTruthy();
    expect(screen.getByText('திரும்பப் பெறு (rollback)')).toBeTruthy();
  });

  it('shows which files changed when the server refuses to overwrite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? json({ error: 'files_changed', message: 'x', paths: ['src/app.ts'] }, 409)
          : json(pending),
      ),
    );
    render(<ChangesPanel projectId={P} changeId={CID} />);
    await userEvent.click(await screen.findByText('அனுமதித்து எழுது'));
    await userEvent.click(screen.getByText('உறுதியாக files-இல் எழுதவா?'));
    expect(await screen.findByText(/இதற்கிடையில் சில files மாறியுள்ளன/)).toBeTruthy();
    expect(screen.getAllByText('src/app.ts').length).toBeGreaterThan(1);
  });
});

describe('FilesPanel', () => {
  it('explains when the folder is not allowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ state: 'not_allowed', commands: {} })),
    );
    render(<FilesPanel projectId={P} />);
    expect(await screen.findByText(/WORKSPACE_ROOTS/)).toBeTruthy();
  });

  it('editing proposes a change with the base hash, never writes directly', async () => {
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/workspace')) return json({ state: 'ok', commands: {} });
        if (url.includes('/file?'))
          return json({ path: 'src/app.ts', content: 'a\n', sha256: 'f'.repeat(64), size: 2 });
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) });
          return json({ ...pending }, 201);
        }
        return json([]);
      }),
    );
    render(<FilesPanel projectId={P} file="src/app.ts" />);
    await userEvent.click(await screen.findByText('திருத்து'));
    const editor = screen.getByLabelText('src/app.ts திருத்தம்');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'b');
    await userEvent.click(screen.getByText('மாற்றத்தைப் பரிந்துரை'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: `/api/projects/${P}/changes`,
      body: {
        title: 'திருத்தம்: src/app.ts',
        files: [{ path: 'src/app.ts', content: 'b', baseSha256: 'f'.repeat(64) }],
      },
    });
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${P}/changes/${CID}`));
  });
});
