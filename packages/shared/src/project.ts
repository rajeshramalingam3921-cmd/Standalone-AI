import { z } from 'zod';
import { TASK_STATUSES } from './task-status.js';

// Control characters are never valid in names, paths or labels.
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

const singleLine = (max: number) =>
  z.string().trim().max(max).regex(NO_CONTROL_CHARS, 'Must not contain control characters');

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
});
export type ProjectCreateInput = z.input<typeof ProjectCreateSchema>;

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
