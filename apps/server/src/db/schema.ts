import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  TASK_STATUSES,
  type AuditDetail,
  type ChangeFile,
  type ProjectCommands,
  type TaskAgentState,
  type TaskHistoryEntry,
} from '@thiran/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' }).notNull();

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    techStack: jsonb('tech_stack').$type<string[]>().notNull().default([]),
    workspacePath: text('workspace_path').notNull().default(''),
    commands: jsonb('commands').$type<ProjectCommands>().notNull().default({}),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [uniqueIndex('projects_name_lower_key').on(sql`lower(${t.name})`)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull(),
    history: jsonb('history').$type<TaskHistoryEntry[]>().notNull(),
    agent: jsonb('agent').$type<TaskAgentState>(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('tasks_project_created_idx').on(t.projectId, t.createdAt),
    check(
      'tasks_status_check',
      sql.raw(`status IN (${TASK_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
  ],
);

/** Single-row table: the one owner of this personal installation. */
export const owner = pgTable(
  'owner',
  {
    id: smallint('id').primaryKey().default(1),
    passwordHash: text('password_hash').notNull(),
    updatedAt: ts('updated_at'),
  },
  (t) => [check('owner_single_row', sql`${t.id} = 1`)],
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    createdAt: ts('created_at'),
    expiresAt: ts('expires_at'),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    model: text('model').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('conversations_project_updated_idx').on(t.projectId, t.updatedAt)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull(),
    model: text('model'),
    error: text('error'),
    usage: jsonb('usage').$type<{ inputTokens: number; outputTokens: number }>(),
    createdAt: ts('created_at'),
  },
  (t) => [
    index('chat_messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    check('chat_messages_role_check', sql`${t.role} IN ('user', 'assistant')`),
    check(
      'chat_messages_status_check',
      sql`${t.status} IN ('complete', 'truncated', 'refused', 'stopped', 'error')`,
    ),
  ],
);

export const changeSets = pgTable(
  'change_sets',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    source: text('source').notNull(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    files: jsonb('files').$type<ChangeFile[]>().notNull(),
    createdAt: ts('created_at'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('change_sets_project_created_idx').on(t.projectId, t.createdAt),
    check(
      'change_sets_status_check',
      sql`${t.status} IN ('pending', 'applied', 'rejected', 'reverted')`,
    ),
    check('change_sets_source_check', sql`${t.source} IN ('user', 'agent')`),
  ],
);

export const commandRuns = pgTable(
  'command_runs',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    argv: jsonb('argv').$type<string[]>().notNull(),
    status: text('status').notNull(),
    exitCode: integer('exit_code'),
    output: text('output').notNull(),
    startedAt: ts('started_at'),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('command_runs_project_started_idx').on(t.projectId, t.startedAt),
    check('command_runs_name_check', sql`${t.name} IN ('build', 'test', 'lint')`),
    check(
      'command_runs_status_check',
      sql`${t.status} IN ('running', 'passed', 'failed', 'timeout', 'error')`,
    ),
  ],
);

/** Append-only (UPDATE/DELETE blocked by a trigger in migration 0004). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    at: ts('at'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    projectId: uuid('project_id'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detail: jsonb('detail').$type<AuditDetail>().notNull(),
  },
  (t) => [
    index('audit_events_at_idx').on(t.at),
    index('audit_events_project_at_idx').on(t.projectId, t.at),
    check('audit_events_actor_check', sql`${t.actor} IN ('owner', 'agent', 'system')`),
  ],
);
