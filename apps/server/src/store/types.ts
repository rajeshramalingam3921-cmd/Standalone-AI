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

export interface SessionRecord {
  /** SHA-256 of the session token. The raw token is never stored. */
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Persistence boundary, implemented by a JSON file (zero-setup) and PostgreSQL.
 * Every task method is scoped by projectId so one project's data can never be
 * read or changed through another project.
 */
export interface Store {
  readonly kind: 'json' | 'postgres';

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

  getOwnerPasswordHash(): Promise<string | undefined>;
  /** Sets the owner password and signs out every existing session. */
  setOwnerPasswordHash(hash: string): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;

  close(): Promise<void>;
}
