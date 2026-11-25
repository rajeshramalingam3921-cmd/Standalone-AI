import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  TaskCreateSchema,
  USER_TASK_ACTIONS,
  USER_TASK_ACTION_NAMES,
  taskStatusGroup,
  type ApiError,
  type ProjectSummary,
  type TaskStatus,
} from '@thiran/shared';
import { z } from 'zod';
import type { AgentEngine } from '../agent/engine.js';
import type { Store } from '../store/types.js';

const Uuid = z.uuid();
const ActionBody = z
  .object({
    action: z.enum(USER_TASK_ACTION_NAMES),
    /** Owner feedback for request_changes. */
    feedback: z.string().trim().max(4000).optional(),
  })
  .strict();

function validationError(reply: FastifyReply, error: z.ZodError) {
  // Report paths and messages only — never echo the submitted values back.
  const body: ApiError = {
    error: 'validation_error',
    message: 'Some fields are invalid.',
    issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
  return reply.status(400).send(body);
}

const notFound = (reply: FastifyReply, what: string) =>
  reply.status(404).send({ error: 'not_found', message: `${what} not found.` } satisfies ApiError);

export function registerProjectRoutes(
  app: FastifyInstance,
  store: Store,
  agent: AgentEngine,
): void {
  app.get('/api/projects', async (): Promise<ProjectSummary[]> => {
    const projects = await store.listProjects();
    return Promise.all(
      projects.map(async (p) => {
        const taskCounts = { waiting: 0, running: 0, failed: 0, done: 0 };
        for (const t of await store.listTasks(p.id)) taskCounts[taskStatusGroup(t.status)]++;
        return { ...p, taskCounts };
      }),
    );
  });

  app.post('/api/projects', async (req, reply) => {
    const parsed = ProjectCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    return reply.status(201).send(await store.createProject(parsed.data));
  });

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId', async (req, reply) => {
    const { projectId } = req.params;
    const project = Uuid.safeParse(projectId).success && (await store.getProject(projectId));
    return project || notFound(reply, 'Project');
  });

  app.patch<{ Params: { projectId: string } }>('/api/projects/:projectId', async (req, reply) => {
    const { projectId } = req.params;
    if (!Uuid.safeParse(projectId).success || !(await store.getProject(projectId))) {
      return notFound(reply, 'Project');
    }
    const parsed = ProjectUpdateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as typeof parsed.data;
    req.log.info({ projectId, fields: Object.keys(patch) }, 'Project updated');
    return store.updateProject(projectId, patch as Parameters<Store['updateProject']>[1]);
  });

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/tasks',
    async (req, reply) => {
      const { projectId } = req.params;
      if (!Uuid.safeParse(projectId).success || !(await store.getProject(projectId))) {
        return notFound(reply, 'Project');
      }
      return store.listTasks(projectId);
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/tasks',
    async (req, reply) => {
      const { projectId } = req.params;
      if (!Uuid.safeParse(projectId).success || !(await store.getProject(projectId))) {
        return notFound(reply, 'Project');
      }
      const parsed = TaskCreateSchema.safeParse(req.body);
      if (!parsed.success) return validationError(reply, parsed.error);
      return reply.status(201).send(await store.createTask(projectId, parsed.data));
    },
  );

  app.post<{ Params: { projectId: string; taskId: string } }>(
    '/api/projects/:projectId/tasks/:taskId/actions',
    async (req, reply) => {
      const { projectId, taskId } = req.params;
      if (!Uuid.safeParse(projectId).success || !Uuid.safeParse(taskId).success) {
        return notFound(reply, 'Task');
      }
      const parsed = ActionBody.safeParse(req.body);
      if (!parsed.success) return validationError(reply, parsed.error);

      const task = await store.getTask(projectId, taskId);
      if (!task) return notFound(reply, 'Task');

      const action = USER_TASK_ACTIONS[parsed.data.action];
      if (!(action.from as readonly TaskStatus[]).includes(task.status)) {
        return reply.status(409).send({
          error: 'invalid_action',
          message: `Action "${parsed.data.action}" is not allowed while the task is ${task.status}.`,
        } satisfies ApiError);
      }
      const blocked = agent.precheck(task, parsed.data.action);
      if (blocked) {
        return reply.status(409).send({
          error: blocked,
          message: `Action "${parsed.data.action}" is not possible now (${blocked}).`,
        } satisfies ApiError);
      }
      // The status change is atomic in the store, so a double tap cannot start two jobs.
      const updated = await store.transitionTask(projectId, taskId, action.to, 'user');
      const project = (await store.getProject(projectId))!;
      await agent.onUserAction(project, updated, parsed.data.action, parsed.data.feedback);
      return (await store.getTask(projectId, taskId))!;
    },
  );
}
