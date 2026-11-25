// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditEvent } from '@thiran/shared';
import { AuditPage, detailLine } from '../src/components/AuditPage';
import { SystemPage } from '../src/components/SystemPage';
import { href, parseRoute, type Route } from '../src/router';

const P = '11111111-1111-4111-8111-111111111111';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ev = (i: number): AuditEvent => ({
  id: `e${i}`,
  at: new Date(Date.UTC(2026, 10, 25, 0, 0, 60 - (i % 60))).toISOString(),
  actor: i % 2 ? 'owner' : 'agent',
  action: i % 2 ? 'change.applied' : 'agent.plan_ready',
  projectId: P,
  targetType: 'change',
  targetId: 'c',
  detail: { paths: ['src/a.js', 'src/b.js'], status: 'ok' },
});

describe('routes', () => {
  it('round-trips audit and system routes', () => {
    const routes: Route[] = [
      { name: 'system' },
      { name: 'audit' },
      { name: 'audit', projectId: P },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
    expect(parseRoute('#/audit/not-a-uuid')).toEqual({ name: 'dashboard' });
  });
});

describe('AuditPage', () => {
  it('lists events with Tamil labels and loads older pages using the "before" cursor', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return json(
          url.includes('before=') ? [ev(99)] : Array.from({ length: 50 }, (_, i) => ev(i)),
        );
      }),
    );
    render(<AuditPage projectId={P} />);
    expect((await screen.findAllByText('மாற்றம் files-இல் எழுதப்பட்டது')).length).toBeGreaterThan(0);
    expect(urls[0]).toBe(`/api/audit?projectId=${P}&limit=50`);
    await userEvent.click(screen.getByText('மேலும் காட்டு'));
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[1]).toContain(`before=${encodeURIComponent(ev(49).at)}`);
  });

  it('formats details as plain text', () => {
    expect(detailLine({ paths: ['a', 'b'], status: 'passed', exitCode: 0, ignored: 'x' })).toBe(
      'status: passed · exitCode: 0 · paths: a, b',
    );
  });
});

describe('SystemPage', () => {
  it('warns when backups are stale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          version: '0.1.0',
          store: 'json',
          aiConfigured: false,
          aiProvider: 'anthropic',
          workspaceRoots: 0,
          lastBackupAt: null,
          backupStale: true,
        }),
      ),
    );
    render(<SystemPage />);
    expect(await screen.findByText('Backup தேவை')).toBeTruthy();
    expect(screen.getByText('pnpm backup')).toBeTruthy();
    expect(screen.getAllByText('கவனிக்கவும்').length).toBe(4);
  });
});
