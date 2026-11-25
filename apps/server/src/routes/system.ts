import type { FastifyInstance } from 'fastify';
import type { AuditEvent, SystemStatus } from '@thiran/shared';
import { z } from 'zod';
import type { AiProvider } from '../ai/types.js';
import { latestBackup } from '../backup.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';
import { VERSION } from '../version.js';

const AuditQuery = z
  .object({
    projectId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.iso.datetime().optional(),
  })
  .strict();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function registerSystemRoutes(
  app: FastifyInstance,
  store: Store,
  config: AppConfig,
  provider: AiProvider,
  now: () => Date = () => new Date(),
): void {
  app.get('/api/audit', async (req, reply) => {
    const q = AuditQuery.safeParse(req.query);
    if (!q.success)
      return reply.status(400).send({ error: 'validation_error', message: 'Invalid query.' });
    const { projectId, limit, before } = q.data;
    return (await store.listAudit({
      limit,
      ...(projectId && { projectId }),
      ...(before && { before }),
    })) satisfies AuditEvent[];
  });

  app.get('/api/system/status', async (): Promise<SystemStatus> => {
    const last = await latestBackup(config);
    return {
      version: VERSION,
      store: store.kind,
      aiConfigured: provider.configured,
      aiProvider: provider.id,
      workspaceRoots: config.WORKSPACE_ROOTS.length,
      lastBackupAt: last?.at.toISOString() ?? null,
      backupStale: !last || now().getTime() - last.at.getTime() > WEEK_MS,
    };
  });
}
