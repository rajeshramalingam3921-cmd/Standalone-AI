import { TASK_STATUS_LABEL_TA, taskStatusGroup, type TaskStatus } from '@thiran/shared';

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`badge tone-${status === 'cancelled' ? 'muted' : taskStatusGroup(status)}`}
      data-status={status}
    >
      {TASK_STATUS_LABEL_TA[status]}
    </span>
  );
}
