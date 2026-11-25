import { describe, expect, it } from 'vitest';
import {
  TASK_STATUSES,
  USER_TASK_ACTIONS,
  USER_TASK_ACTION_NAMES,
  availableUserActions,
  canTransition,
  taskStatusGroup,
} from '../src/index.js';

describe('user task actions', () => {
  it('every user action is a valid state-machine transition', () => {
    for (const name of USER_TASK_ACTION_NAMES) {
      const { from, to } = USER_TASK_ACTIONS[name];
      for (const f of from) expect(canTransition(f, to), `${name}: ${f}→${to}`).toBe(true);
    }
  });

  it('no user action can complete a task', () => {
    for (const name of USER_TASK_ACTION_NAMES)
      expect(USER_TASK_ACTIONS[name].to).not.toBe('completed');
  });

  it('only allows approval while awaiting approval', () => {
    expect(availableUserActions('awaiting_approval')).toContain('approve');
    expect(availableUserActions('draft')).toEqual(['cancel']);
    expect(availableUserActions('completed')).toEqual([]);
    expect(availableUserActions('cancelled')).toEqual([]);
  });

  it('groups every status', () => {
    for (const s of TASK_STATUSES) expect(taskStatusGroup(s)).toBeTruthy();
    expect(taskStatusGroup('verifying')).toBe('running');
    expect(taskStatusGroup('needs_attention')).toBe('waiting');
  });
});
