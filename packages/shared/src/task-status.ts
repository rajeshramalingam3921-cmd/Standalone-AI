/**
 * Task lifecycle for the controlled workflow:
 * plan → review (approval) → execute → test → report.
 *
 * Every transition must go through `assertTransition` so that a task can
 * never skip approval or jump from "failed" straight to "completed".
 */
export const TASK_STATUSES = [
  'draft',
  'planning',
  'awaiting_approval',
  'running',
  'verifying',
  'needs_attention',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['planning', 'cancelled'],
  planning: ['awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['running', 'planning', 'cancelled'],
  running: ['verifying', 'failed', 'cancelled'],
  verifying: ['completed', 'needs_attention', 'failed', 'cancelled'],
  needs_attention: ['planning', 'cancelled'],
  completed: [],
  failed: ['planning', 'cancelled'],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid task status transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Simple Tamil labels for mobile status badges. */
export const TASK_STATUS_LABEL_TA: Readonly<Record<TaskStatus, string>> = {
  draft: 'வரைவு',
  planning: 'திட்டமிடப்படுகிறது',
  awaiting_approval: 'அனுமதிக்காகக் காத்திருக்கிறது',
  running: 'இயங்குகிறது',
  verifying: 'சரிபார்க்கப்படுகிறது',
  needs_attention: 'கவனம் தேவை',
  completed: 'முடிந்தது',
  failed: 'தோல்வி',
  cancelled: 'ரத்து செய்யப்பட்டது',
};
