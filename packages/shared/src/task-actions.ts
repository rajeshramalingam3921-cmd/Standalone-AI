import type { TaskStatus } from './task-status.js';

/**
 * Actions a *user* may take on a task. Everything else (planning, running,
 * verifying, completing) is driven by the agent engine and verification —
 * a user cannot mark a task "completed" by hand.
 */
export const USER_TASK_ACTIONS = {
  /** Ask the AI agent to (re)plan this task. */
  plan: { from: ['draft', 'failed', 'needs_attention'], to: 'planning' },
  approve: { from: ['awaiting_approval'], to: 'running' },
  request_changes: { from: ['awaiting_approval'], to: 'planning' },
  cancel: {
    from: [
      'draft',
      'planning',
      'awaiting_approval',
      'running',
      'verifying',
      'needs_attention',
      'failed',
    ],
    to: 'cancelled',
  },
} as const satisfies Record<string, { from: readonly TaskStatus[]; to: TaskStatus }>;

export type UserTaskAction = keyof typeof USER_TASK_ACTIONS;
export const USER_TASK_ACTION_NAMES = Object.keys(USER_TASK_ACTIONS) as UserTaskAction[];

export function availableUserActions(status: TaskStatus): UserTaskAction[] {
  return USER_TASK_ACTION_NAMES.filter((a) =>
    (USER_TASK_ACTIONS[a].from as readonly TaskStatus[]).includes(status),
  );
}

export const USER_TASK_ACTION_LABEL_TA: Readonly<Record<UserTaskAction, string>> = {
  plan: 'AI திட்டமிடட்டும்',
  approve: 'திட்டத்தை அனுமதி',
  request_changes: 'மாற்றம் கேள்',
  cancel: 'ரத்து செய்',
};

/** Coarse grouping used for badges and dashboard counts. */
export type TaskStatusGroup = 'waiting' | 'running' | 'failed' | 'done';

export function taskStatusGroup(status: TaskStatus): TaskStatusGroup {
  switch (status) {
    case 'running':
    case 'verifying':
      return 'running';
    case 'failed':
      return 'failed';
    case 'completed':
    case 'cancelled':
      return 'done';
    default:
      return 'waiting';
  }
}

export const TASK_STATUS_GROUP_LABEL_TA: Readonly<Record<TaskStatusGroup, string>> = {
  waiting: 'காத்திருப்பவை',
  running: 'இயங்குபவை',
  failed: 'தோல்வி',
  done: 'முடிந்தவை',
};
