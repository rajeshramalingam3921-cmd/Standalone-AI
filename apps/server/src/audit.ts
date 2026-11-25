import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditAction, AuditActor, AuditDetail } from '@thiran/shared';
import type { Store } from './store/types.js';

export interface AuditInput {
  actor: AuditActor;
  action: AuditAction;
  projectId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  detail?: AuditDetail;
}

/** Records audit events. Never throws: a failed audit write is logged, not surfaced. */
export class AuditLog {
  constructor(
    private readonly store: Store,
    private readonly log: Pick<FastifyBaseLogger, 'error'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(e: AuditInput): Promise<void> {
    try {
      await this.store.appendAudit({
        id: randomUUID(),
        at: this.now().toISOString(),
        actor: e.actor,
        action: e.action,
        projectId: e.projectId ?? null,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        detail: e.detail ?? {},
      });
    } catch (err) {
      this.log.error({ err, action: e.action }, 'Audit write failed');
    }
  }
}
