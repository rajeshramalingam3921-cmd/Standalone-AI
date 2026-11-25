// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task, TaskAgentState } from '@thiran/shared';
import { ReportView, TaskDetail } from '../src/components/TaskDetail';

const P = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const CS = '33333333-3333-4333-8333-333333333333';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const agent = (over: Partial<TaskAgentState> = {}): TaskAgentState => ({
  attempts: 0,
  plans: 1,
  phase: 'awaiting_plan_approval',
  plan: {
    summary: 'GST சேர்க்கப்படும்',
    steps: ['billing.js படி', 'GST கணக்கிடு'],
    files: ['src/billing.js'],
    checks: ['test'],
  },
  feedback: null,
  changeSetId: null,
  checks: [],
  summary: null,
  report: null,
  error: null,
  activity: [{ at: '2026-11-25T00:00:00.000Z', kind: 'tool', text: '📄 read_file src/billing.js' }],
  usage: { inputTokens: 0, outputTokens: 0 },
  ...over,
});
const task = (over: Partial<Task> = {}): Task => ({
  id: T,
  projectId: P,
  title: 'Billing GST',
  description: '',
  status: 'awaiting_approval',
  history: [],
  agent: agent(),
  createdAt: '2026-11-25T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaskDetail', () => {
  it('shows the AI plan and approves it', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return json(
            task({ status: 'running', agent: agent({ phase: 'executing', attempts: 1 }) }),
          );
        }
        return json([task()]);
      }),
    );
    render(<TaskDetail projectId={P} taskId={T} />);
    expect(await screen.findByText('GST சேர்க்கப்படும்')).toBeTruthy();
    expect(screen.getByText('GST கணக்கிடு')).toBeTruthy();
    expect(screen.getByText('src/billing.js')).toBeTruthy();
    await userEvent.click(screen.getByText('திட்டத்தை அனுமதி'));
    await waitFor(() => expect(posts).toEqual([{ action: 'approve' }]));
  });

  it('request changes needs written feedback, which is sent to the server', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return json(task({ status: 'planning', agent: agent({ phase: 'planning' }) }));
        }
        return json([task()]);
      }),
    );
    render(<TaskDetail projectId={P} taskId={T} />);
    await userEvent.click(await screen.findByText('மாற்றம் கேள்'));
    const send = screen.getByText('கருத்தை அனுப்பு') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/AI-க்கு உங்கள் கருத்து/), 'GST 18%');
    await userEvent.click(send);
    await waitFor(() =>
      expect(posts).toEqual([{ action: 'request_changes', feedback: 'GST 18%' }]),
    );
  });

  it('links to the proposed diff and shows a Tamil server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? json({ error: 'attempt_limit', message: 'x' }, 409)
          : json([
              task({
                status: 'running',
                agent: agent({ phase: 'awaiting_diff', changeSetId: CS, attempts: 1 }),
              }),
            ]),
      ),
    );
    render(<TaskDetail projectId={P} taskId={T} />);
    const link = (await screen.findByText('AI பரிந்துரைத்த மாற்றங்கள் தயார்')).closest('a')!;
    expect(link.getAttribute('href')).toBe(`#/projects/${P}/changes/${CS}`);
    await userEvent.click(screen.getByText('ரத்து செய்'));
    await userEvent.click(screen.getByText('உறுதியாக ரத்து செய்?'));
    expect(await screen.findByText('இந்த task-க்கான முயற்சி வரம்பு முடிந்தது')).toBeTruthy();
  });
});

describe('ReportView', () => {
  it('renders the report as text (no HTML injection)', () => {
    const { container } = render(
      <ReportView
        text={'# அறிக்கை\n**முடிவு:** ✅\n- `a.ts` +1\n<img src=x onerror=alert(1)>\n_Tokens: 5_'}
      />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('அறிக்கை');
    expect(container.querySelector('strong')?.textContent).toBe('முடிவு:');
    expect(container.querySelector('code')?.textContent).toBe('a.ts');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('small')?.textContent).toBe('Tokens: 5');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
