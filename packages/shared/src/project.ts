import { z } from 'zod';
import { TASK_STATUSES } from './task-status.js';

// Control characters are never valid in names, paths or labels.
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

const singleLine = (max: number) =>
  z.string().trim().max(max).regex(NO_CONTROL_CHARS, 'Must not contain control characters');

/**
 * A command the owner allows to run in the project folder, as an argument list
 * (no shell). Example: ["pnpm", "test"]. Only the owner sets these; the AI can
 * only ask to run one of them by name.
 */
const Argv = z
  .array(z.string().min(1).max(500).regex(NO_CONTROL_CHARS, 'Must not contain control characters'))
  .min(1)
  .max(50);

export const COMMAND_NAMES = ['build', 'test', 'lint'] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export const ProjectCommandsSchema = z
  .object({ build: Argv.optional(), test: Argv.optional(), lint: Argv.optional() })
  .strict();
export type ProjectCommands = z.output<typeof ProjectCommandsSchema>;

export const ProjectCreateSchema = z.object({
  name: singleLine(80).min(1, 'Name is required'),
  description: z.string().trim().max(1000).default(''),
  techStack: z.array(singleLine(40).min(1)).max(20).default([]),
  /**
   * Reference to where the project lives (local folder or other authorized workspace).
   * Stored as metadata only — the server does not read this path until Phase 6,
   * when file access is sandboxed to it.
   */
  workspacePath: singleLine(500).default(''),
  commands: ProjectCommandsSchema.default({}),
});
export type ProjectCreateInput = z.input<typeof ProjectCreateSchema>;

/** PATCH /api/projects/:id — any subset of the create fields. */
export const ProjectUpdateSchema = z
  .object({
    name: ProjectCreateSchema.shape.name,
    description: z.string().trim().max(1000),
    techStack: ProjectCreateSchema.shape.techStack.unwrap(),
    workspacePath: singleLine(500),
    commands: ProjectCommandsSchema,
  })
  .partial()
  .strict();
export type ProjectUpdateInput = z.input<typeof ProjectUpdateSchema>;

export const ProjectSchema = ProjectCreateSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.output<typeof ProjectSchema>;

export const TaskCreateSchema = z.object({
  title: singleLine(200).min(1, 'Title is required'),
  description: z.string().trim().max(10_000).default(''),
});
export type TaskCreateInput = z.input<typeof TaskCreateSchema>;

export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const TaskHistoryEntrySchema = z.object({
  from: TaskStatusSchema.nullable(),
  to: TaskStatusSchema,
  at: z.iso.datetime(),
  by: z.enum(['user', 'system']),
});
export type TaskHistoryEntry = z.output<typeof TaskHistoryEntrySchema>;

export const TaskSchema = TaskCreateSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  status: TaskStatusSchema,
  history: z.array(TaskHistoryEntrySchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Task = z.output<typeof TaskSchema>;

export interface ProjectSummary extends Project {
  taskCounts: Record<'waiting' | 'running' | 'failed' | 'done', number>;
}

/** Standard error body returned by the API. */
export interface ApiError {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

/** GET /api/auth/session */
export interface SessionStatus {
  authenticated: boolean;
  /** No owner password has been set yet (run the set-password command on the server). */
  setupRequired: boolean;
}

export const LoginSchema = z.object({ password: z.string().min(1).max(1024) });
