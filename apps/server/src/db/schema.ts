import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TASK_STATUSES, type TaskHistoryEntry } from '@thiran/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' }).notNull();

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    techStack: jsonb('tech_stack').$type<string[]>().notNull().default([]),
    workspacePath: text('workspace_path').notNull().default(''),
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
