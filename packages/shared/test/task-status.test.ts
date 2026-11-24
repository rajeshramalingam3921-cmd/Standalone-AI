import { describe, expect, it } from 'vitest';
import {
  TASK_STATUSES,
  TASK_STATUS_LABEL_TA,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isTaskStatus,
} from '../src/index.js';

describe('task status state machine', () => {
  it('requires approval before running', () => {
    expect(canTransition('planning', 'running')).toBe(false);
    expect(canTransition('planning', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'running')).toBe(true);
  });

  it('cannot mark a task completed without verification', () => {
    expect(canTransition('running', 'completed')).toBe(false);
    expect(canTransition('verifying', 'completed')).toBe(true);
  });

  it('cannot jump from failed to completed', () => {
    expect(() => assertTransition('failed', 'completed')).toThrow(InvalidTransitionError);
  });

  it('treats completed and cancelled as terminal', () => {
    for (const to of TASK_STATUSES) {
      expect(canTransition('completed', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
  });

  it('has a Tamil label for every status', () => {
    for (const s of TASK_STATUSES) expect(TASK_STATUS_LABEL_TA[s]).toBeTruthy();
  });

  it('validates unknown input', () => {
    expect(isTaskStatus('running')).toBe(true);
    expect(isTaskStatus('done')).toBe(false);
    expect(isTaskStatus(42)).toBe(false);
  });
});
