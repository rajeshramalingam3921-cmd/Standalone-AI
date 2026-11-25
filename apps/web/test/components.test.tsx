// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '@thiran/shared';
import { TaskItem } from '../src/components/ProjectView';
import { NewProject } from '../src/components/NewProject';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const task: Task = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  title: 'Billing screen',
  description: '',
  status: 'draft',
  history: [],
  createdAt: '2026-11-25T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaskItem', () => {
  it('shows the Tamil status and only allowed actions', () => {
    render(<TaskItem task={task} onChanged={() => {}} />);
    expect(screen.getByText('வரைவு')).toBeTruthy();
    expect(screen.queryByText('அனுமதி அளி')).toBeNull(); // cannot approve a draft
    expect(screen.getByText('ரத்து செய்')).toBeTruthy();
  });

  it('requires a second tap to cancel, then calls the API once', async () => {
    const onChanged = vi.fn();
    fetchMock.mockResolvedValue(json({ ...task, status: 'cancelled' }));
    render(<TaskItem task={task} onChanged={onChanged} />);

    await userEvent.click(screen.getByText('ரத்து செய்'));
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('உறுதியாக ரத்து செய்?'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/projects/${task.projectId}/tasks/${task.id}/actions`);
    expect(JSON.parse(init.body)).toEqual({ action: 'cancel' });
  });

  it('shows no actions for a completed task', () => {
    render(<TaskItem task={{ ...task, status: 'completed' }} onChanged={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('NewProject', () => {
  it('keeps the draft across a remount (page refresh)', async () => {
    const first = render(<NewProject />);
    await userEvent.type(screen.getByLabelText(/பெயர்/), 'ERP');
    first.unmount();

    render(<NewProject />);
    expect((screen.getByLabelText(/பெயர்/) as HTMLInputElement).value).toBe('ERP');
  });

  it('shows server validation errors next to the field', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: 'validation_error',
          message: 'x',
          issues: [{ path: 'name', message: 'Name is required' }],
        },
        400,
      ),
    );
    render(<NewProject />);
    await userEvent.click(screen.getByText('Project உருவாக்கு'));
    expect(await screen.findByText('Name is required')).toBeTruthy();
    expect(screen.getByText('சில விவரங்கள் தவறாக உள்ளன')).toBeTruthy();
  });

  it('sends a parsed tech stack, clears the draft and navigates on success', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    fetchMock.mockResolvedValue(json({ id }, 201));
    render(<NewProject />);
    await userEvent.type(screen.getByLabelText(/பெயர்/), 'POS');
    await userEvent.type(screen.getByLabelText(/Technology stack/), 'React, Node');
    await userEvent.click(screen.getByText('Project உருவாக்கு'));

    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${id}`));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      name: 'POS',
      techStack: ['React', 'Node'],
    });
    expect(window.localStorage.getItem('thiran:draft:new-project')).toBeNull();
  });
});
