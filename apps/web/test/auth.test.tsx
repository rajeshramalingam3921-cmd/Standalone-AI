// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { UNAUTHORIZED_EVENT, request } from '../src/api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HEALTH = { status: 'ok', service: 'thiran-server', version: '0.1.0', uptimeSeconds: 1 };

/** Minimal fake server: routes by URL; `session` can be changed between steps. */
function fakeServer(state: { session: { authenticated: boolean; setupRequired: boolean } }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/health') return json(HEALTH);
    if (url === '/api/auth/session') return json(state.session);
    if (url === '/api/auth/login') {
      const { password } = JSON.parse(String(init?.body)) as { password: string };
      if (password !== 'right password') {
        return json({ error: 'invalid_credentials', message: 'x' }, 401);
      }
      state.session = { authenticated: true, setupRequired: false };
      return json(state.session);
    }
    if (url === '/api/auth/logout') {
      state.session = { authenticated: false, setupRequired: false };
      return json(state.session);
    }
    if (url === '/api/projects') {
      return state.session.authenticated ? json([]) : json({ error: 'unauthenticated' }, 401);
    }
    return json({ error: 'not_found' }, 404);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('auth flow', () => {
  it('shows setup instructions when no owner password exists', async () => {
    vi.stubGlobal('fetch', fakeServer({ session: { authenticated: false, setupRequired: true } }));
    render(<App />);
    expect(await screen.findByText('pnpm set-password')).toBeTruthy();
  });

  it('wrong password shows a Tamil error and clears the field; right password opens dashboard', async () => {
    vi.stubGlobal('fetch', fakeServer({ session: { authenticated: false, setupRequired: false } }));
    render(<App />);
    const pw = await screen.findByLabelText('கடவுச்சொல்');

    await userEvent.type(pw, 'wrong');
    await userEvent.click(screen.getByText('உள்நுழை'));
    expect(await screen.findByText('கடவுச்சொல் தவறு')).toBeTruthy();
    expect((pw as HTMLInputElement).value).toBe('');

    await userEvent.type(pw, 'right password');
    await userEvent.click(screen.getByText('உள்நுழை'));
    expect(await screen.findByText('இன்னும் project எதுவும் இல்லை.')).toBeTruthy();
  });

  it('logout returns to the login screen', async () => {
    vi.stubGlobal('fetch', fakeServer({ session: { authenticated: true, setupRequired: false } }));
    render(<App />);
    await userEvent.click(await screen.findByText('வெளியேறு'));
    expect(await screen.findByLabelText('கடவுச்சொல்')).toBeTruthy();
  });

  it('an expired session (401 on any request) returns to the login screen', async () => {
    vi.stubGlobal('fetch', fakeServer({ session: { authenticated: true, setupRequired: false } }));
    render(<App />);
    await screen.findByText('வெளியேறு');
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    await waitFor(() => expect(screen.getByLabelText('கடவுச்சொல்')).toBeTruthy());
  });
});

describe('request 401 handling', () => {
  it('fires the unauthorized event for API calls but not for auth endpoints', async () => {
    const seen = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, seen);
    const unauth = (async () => json({ error: 'unauthenticated' }, 401)) as unknown as typeof fetch;
    await request('/api/auth/login', {}, unauth);
    expect(seen).not.toHaveBeenCalled();
    const r = await request('/api/projects', {}, unauth);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, status: 401, code: 'unauthenticated' });
    window.removeEventListener(UNAUTHORIZED_EVENT, seen);
  });
});
