import type {
  ChangeSet,
  ChangeSetStatus,
  CommandRun,
  ChatMessage,
  Conversation,
  Project,
  ProjectCreateSchema,
  Task,
  TaskCreateSchema,
  TaskStatus,
} from '@thiran/shared';
import type { z } from 'zod';

export type NewProject = z.output<typeof ProjectCreateSchema>;
export type NewTask = z.output<typeof TaskCreateSchema>;
export type ProjectPatch = Partial<NewProject>;
export type RunPatch = Pick<CommandRun, 'status' | 'exitCode' | 'output' | 'finishedAt'>;

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
  /** Update fields of a project. Throws ConflictError on a duplicate name. */
  updateProject(projectId: string, patch: ProjectPatch): Promise<Project>;
  listTasks(projectId: string): Promise<Task[]>;
  getTask(projectId: string, taskId: string): Promise<Task | undefined>;
  createTask(projectId: string, input: NewTask): Promise<Task>;
  transitionTask(
    projectId: string,
    taskId: string,
    to: TaskStatus,
    by: 'user' | 'system',
  ): Promise<Task>;

  listConversations(projectId: string): Promise<Conversation[]>;
  getConversation(projectId: string, conversationId: string): Promise<Conversation | undefined>;
  createConversation(
    projectId: string,
    input: { title: string; model: string },
  ): Promise<Conversation>;
  /** Bump updatedAt and optionally set the title. */
  touchConversation(projectId: string, conversationId: string, title?: string): Promise<void>;
  /** Messages of one conversation, oldest first. Caller must have checked the conversation's project. */
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  addMessage(
    message: Omit<ChatMessage, 'createdAt'> & { createdAt?: string },
  ): Promise<ChatMessage>;

  createChangeSet(changeSet: ChangeSet): Promise<ChangeSet>;
  getChangeSet(projectId: string, changeSetId: string): Promise<ChangeSet | undefined>;
  /** Newest first. */
  listChangeSets(projectId: string, limit?: number): Promise<ChangeSet[]>;
  /** Atomically move from one status to another; false if it was not in `from`. */
  setChangeSetStatus(
    projectId: string,
    changeSetId: string,
    from: ChangeSetStatus,
    to: ChangeSetStatus,
    at: string,
  ): Promise<boolean>;

  createRun(run: CommandRun): Promise<CommandRun>;
  updateRun(projectId: string, runId: string, patch: RunPatch): Promise<void>;
  getRun(projectId: string, runId: string): Promise<CommandRun | undefined>;
  /** Newest first. */
  listRuns(projectId: string, limit?: number): Promise<CommandRun[]>;
  /** Mark runs left "running" by a previous server process as errored. */
  failInterruptedRuns(at: string): Promise<number>;

  getOwnerPasswordHash(): Promise<string | undefined>;
  /** Sets the owner password and signs out every existing session. */
  setOwnerPasswordHash(hash: string): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | undefined>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;

  close(): Promise<void>;
}
