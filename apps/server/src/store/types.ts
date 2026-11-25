import type {
  Project,
  ProjectCreateSchema,
  Task,
  TaskCreateSchema,
  TaskStatus,
} from '@thiran/shared';
import type { z } from 'zod';

export type NewProject = z.output<typeof ProjectCreateSchema>;
export type NewTask = z.output<typeof TaskCreateSchema>;

/**
 * Persistence boundary. Phase 3 uses a JSON file; Phase 4 swaps in PostgreSQL
 * behind the same interface. Every task method is scoped by projectId so one
 * project's data can never be read or changed through another project.
 */
export interface Store {
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | undefined>;
  createProject(input: NewProject): Promise<Project>;
  listTasks(projectId: string): Promise<Task[]>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  createTask(projectId: string, input: NewTask): Promise<Task>;
  transitionTask(
    projectId: string,
    taskId: string,
    to: TaskStatus,
    by: 'user' | 'system',
  ): Promise<Task>;
}
