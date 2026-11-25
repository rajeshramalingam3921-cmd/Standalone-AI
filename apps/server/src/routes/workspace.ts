import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  COMMAND_NAMES,
  ChangeSetCreateSchema,
  type ApiError,
  type FileContent,
  type FileEntry,
  type Project,
  type WorkspaceInfo,
} from '@thiran/shared';
import { z } from 'zod';
import {
  ChangeConflictError,
  NoChangesError,
  applyChangeSet,
  prepareChangeSet,
  revertChangeSet,
  toView,
} from '../agent/changes.js';
import type { AgentEngine } from '../agent/engine.js';
import type { ProjectLocks } from '../agent/locks.js';
import { runCommand } from '../agent/runner.js';
import {
  WorkspaceError,
  openWorkspace,
  resolveWorkspace,
  type Workspace,
} from '../agent/workspace.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';

const Uuid = z.uuid();

const WS_ERROR_STATUS: Record<WorkspaceError['code'], number> = {
  not_configured: 409,
  not_allowed: 409,
  missing: 409,
  invalid_path: 400,
  denied: 403,
  not_found: 404,
  not_a_file: 400,
  not_a_directory: 400,
  too_large: 413,
  binary: 415,
};

const send = (reply: FastifyReply, status: number, body: ApiError & Record<string, unknown>) =>
  reply.status(status).send(body);

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  store: Store,
  config: AppConfig,
  locks: ProjectLocks,
  agent: AgentEngine,
  now: () => Date = () => new Date(),
): void {
  async function getProject(id: string) {
    return Uuid.safeParse(id).success ? store.getProject(id) : undefined;
  }

  /** Resolve the project's folder; replies with an error and returns undefined if unusable. */
  async function workspaceOf(
    project: Project,
    reply: FastifyReply,
  ): Promise<Workspace | undefined> {
    const st = await resolveWorkspace(project.workspacePath, config.WORKSPACE_ROOTS);
    if (st.state !== 'ok') {
      send(reply, 409, {
        error: 'workspace_unavailable',
        message: 'The project folder is not set, not allowed, or missing.',
        state: st.state,
      });
      return undefined;
    }
    return openWorkspace(st.root);
  }

  function handle(reply: FastifyReply, e: unknown) {
    if (e instanceof WorkspaceError) {
      return send(reply, WS_ERROR_STATUS[e.code], { error: `file_${e.code}`, message: e.message });
    }
    if (e instanceof ChangeConflictError) {
      return send(reply, 409, {
        error: 'files_changed',
        message: 'Some files changed in the meantime.',
        paths: e.paths,
      });
    }
    if (e instanceof NoChangesError) {
      return send(reply, 400, { error: 'no_changes', message: 'Nothing would change.' });
    }
    throw e;
  }

  type P = { Params: { projectId: string } };

  app.get<P>('/api/projects/:projectId/workspace', async (req, reply) => {
    const project = await getProject(req.params.projectId);
    if (!project) return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
    const st = await resolveWorkspace(project.workspacePath, config.WORKSPACE_ROOTS);
    // The resolved absolute path is not returned; the owner already knows the folder.
    return { state: st.state, commands: project.commands } satisfies WorkspaceInfo;
  });

  app.get<P & { Querystring: { dir?: string } }>(
    '/api/projects/:projectId/files',
    async (req, reply) => {
      const project = await getProject(req.params.projectId);
      if (!project) return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
      const ws = await workspaceOf(project, reply);
      if (!ws) return reply;
      try {
        return (await ws.list(String(req.query.dir ?? ''))) satisfies FileEntry[];
      } catch (e) {
        return handle(reply, e);
      }
    },
  );

  app.get<P & { Querystring: { path?: string } }>(
    '/api/projects/:projectId/file',
    async (req, reply) => {
      const project = await getProject(req.params.projectId);
      if (!project) return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
      const ws = await workspaceOf(project, reply);
      if (!ws) return reply;
      try {
        return (await ws.read(String(req.query.path ?? ''))) satisfies FileContent;
      } catch (e) {
        return handle(reply, e);
      }
    },
  );

  // ---- Change sets: propose → review diff → apply (owner) → optional revert ----

  app.get<P>('/api/projects/:projectId/changes', async (req, reply) => {
    if (!(await getProject(req.params.projectId))) {
      return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
    }
    const list = await store.listChangeSets(req.params.projectId);
    return list.map((cs) => {
      const v = toView(cs);
      return { ...v, files: v.files.map(({ diff: _diff, ...f }) => f) };
    });
  });

  app.post<P>('/api/projects/:projectId/changes', async (req, reply) => {
    const project = await getProject(req.params.projectId);
    if (!project) return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
    const parsed = ChangeSetCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return send(reply, 400, {
        error: 'validation_error',
        message: 'Some fields are invalid.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const ws = await workspaceOf(project, reply);
    if (!ws) return reply;
    try {
      const cs = await prepareChangeSet(
        ws,
        {
          projectId: project.id,
          title: parsed.data.title,
          source: 'user',
          files: parsed.data.files,
        },
        now(),
      );
      return reply.status(201).send(toView(await store.createChangeSet(cs)));
    } catch (e) {
      return handle(reply, e);
    }
  });

  type C = { Params: { projectId: string; changeId: string } };

  async function loadChange(req: { params: C['Params'] }, reply: FastifyReply) {
    const project = await getProject(req.params.projectId);
    const cs =
      project && Uuid.safeParse(req.params.changeId).success
        ? await store.getChangeSet(project.id, req.params.changeId)
        : undefined;
    if (!project || !cs) {
      send(reply, 404, { error: 'not_found', message: 'Change not found.' });
      return undefined;
    }
    return { project, cs };
  }

  app.get<C>('/api/projects/:projectId/changes/:changeId', async (req, reply) => {
    const found = await loadChange(req, reply);
    return found ? toView(found.cs) : reply;
  });

  app.post<C>('/api/projects/:projectId/changes/:changeId/reject', async (req, reply) => {
    const found = await loadChange(req, reply);
    if (!found) return reply;
    const ok = await store.setChangeSetStatus(
      found.project.id,
      found.cs.id,
      'pending',
      'rejected',
      now().toISOString(),
    );
    if (!ok)
      return send(reply, 409, {
        error: 'invalid_state',
        message: 'Only pending changes can be rejected.',
      });
    await agent.onChangeRejected(found.project, found.cs);
    return toView((await store.getChangeSet(found.project.id, found.cs.id))!);
  });

  for (const action of ['apply', 'revert'] as const) {
    app.post<C>(`/api/projects/:projectId/changes/:changeId/${action}`, async (req, reply) => {
      const found = await loadChange(req, reply);
      if (!found) return reply;
      const { project, cs } = found;
      const [from, to] =
        action === 'apply' ? (['pending', 'applied'] as const) : (['applied', 'reverted'] as const);
      if (cs.status !== from) {
        return send(reply, 409, { error: 'invalid_state', message: `Change is ${cs.status}.` });
      }
      const ws = await workspaceOf(project, reply);
      if (!ws) return reply;
      if (!locks.tryAcquire(project.id)) {
        return send(reply, 409, {
          error: 'busy',
          message: 'Another operation is running for this project.',
        });
      }
      let done: boolean;
      try {
        await (action === 'apply' ? applyChangeSet(ws, cs) : revertChangeSet(ws, cs));
        done = await store.setChangeSetStatus(project.id, cs.id, from, to, now().toISOString());
        req.log.info(
          { projectId: project.id, changeId: cs.id, files: cs.files.length },
          `Change ${action}`,
        );
      } catch (e) {
        return handle(reply, e);
      } finally {
        locks.release(project.id);
      }
      // An applied agent change triggers the owner-defined checks (outside the lock above).
      if (done && action === 'apply') await agent.onChangeApplied(project, cs);
      return toView((await store.getChangeSet(project.id, cs.id))!);
    });
  }

  // ---- Owner-defined commands (build / test / lint) ----

  app.get<P>('/api/projects/:projectId/runs', async (req, reply) => {
    if (!(await getProject(req.params.projectId))) {
      return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
    }
    return store.listRuns(req.params.projectId);
  });

  app.get<{ Params: { projectId: string; runId: string } }>(
    '/api/projects/:projectId/runs/:runId',
    async (req, reply) => {
      const run =
        Uuid.safeParse(req.params.runId).success && Uuid.safeParse(req.params.projectId).success
          ? await store.getRun(req.params.projectId, req.params.runId)
          : undefined;
      return run ?? send(reply, 404, { error: 'not_found', message: 'Run not found.' });
    },
  );

  app.post<P>(
    '/api/projects/:projectId/runs',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const project = await getProject(req.params.projectId);
      if (!project) return send(reply, 404, { error: 'not_found', message: 'Project not found.' });
      const parsed = z
        .object({ name: z.enum(COMMAND_NAMES) })
        .strict()
        .safeParse(req.body);
      if (!parsed.success)
        return send(reply, 400, { error: 'validation_error', message: 'Unknown command.' });
      const argv = project.commands[parsed.data.name];
      if (!argv) {
        return send(reply, 400, {
          error: 'command_not_configured',
          message: 'This command is not set up.',
        });
      }
      const ws = await workspaceOf(project, reply);
      if (!ws) return reply;
      if (!locks.tryAcquire(project.id)) {
        return send(reply, 409, {
          error: 'busy',
          message: 'Another operation is running for this project.',
        });
      }
      const run = await store.createRun({
        id: randomUUID(),
        projectId: project.id,
        name: parsed.data.name,
        argv,
        status: 'running',
        exitCode: null,
        output: '',
        startedAt: now().toISOString(),
        finishedAt: null,
      });
      req.log.info({ projectId: project.id, runId: run.id, name: run.name }, 'Command started');
      // Runs in the background; the client polls GET /runs/:id.
      void runCommand({
        argv,
        cwd: ws.root,
        timeoutMs: config.COMMAND_TIMEOUT_MS,
        maxOutput: config.COMMAND_OUTPUT_MAX,
      })
        .then((r) =>
          store.updateRun(project.id, run.id, {
            status: r.status,
            exitCode: r.exitCode,
            output: r.output,
            finishedAt: now().toISOString(),
          }),
        )
        .catch((e: unknown) =>
          app.log.error({ err: e, runId: run.id }, 'Command bookkeeping failed'),
        )
        .finally(() => locks.release(project.id));
      return reply.status(202).send(run);
    },
  );
}
