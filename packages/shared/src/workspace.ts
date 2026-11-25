import { z } from 'zod';
import type { CommandName } from './commands.js';
import type { ProjectCommands } from './project.js';

/** GET /api/projects/:id/workspace */
export interface WorkspaceInfo {
  state: 'ok' | 'not_configured' | 'not_allowed' | 'missing';
  commands: ProjectCommands;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number | null;
}

export interface FileContent {
  path: string;
  content: string;
  sha256: string;
  size: number;
}

export const ChangeSetCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        content: z.string().max(512 * 1024),
        /** Hash the editor started from; if the file changed since, creation fails (409). */
        baseSha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type ChangeSetCreateInput = z.input<typeof ChangeSetCreateSchema>;

export type ChangeSetStatus = 'pending' | 'applied' | 'rejected' | 'reverted';

export interface ChangeFile {
  path: string;
  action: 'create' | 'modify';
  /** null when the file did not exist. */
  baseSha256: string | null;
  originalContent: string | null;
  newContent: string;
  newSha256: string;
}

export interface ChangeSet {
  id: string;
  projectId: string;
  title: string;
  source: 'user' | 'agent';
  /** Task that produced this change (agent changes). */
  taskId: string | null;
  status: ChangeSetStatus;
  files: ChangeFile[];
  createdAt: string;
  decidedAt: string | null;
}

/** What the API returns: unified diffs instead of full contents. */
export interface ChangeSetView extends Omit<ChangeSet, 'files'> {
  files: {
    path: string;
    action: 'create' | 'modify';
    diff: string;
    additions: number;
    deletions: number;
  }[];
}

export type CommandRunStatus = 'running' | 'passed' | 'failed' | 'timeout' | 'error';

export interface CommandRun {
  id: string;
  projectId: string;
  name: CommandName;
  argv: string[];
  status: CommandRunStatus;
  exitCode: number | null;
  /** Last part of combined stdout/stderr. */
  output: string;
  startedAt: string;
  finishedAt: string | null;
}

export const CHANGE_STATUS_LABEL_TA: Readonly<Record<ChangeSetStatus, string>> = {
  pending: 'அனுமதிக்காகக் காத்திருக்கிறது',
  applied: 'பயன்படுத்தப்பட்டது',
  rejected: 'நிராகரிக்கப்பட்டது',
  reverted: 'திரும்பப் பெறப்பட்டது',
};

export const RUN_STATUS_LABEL_TA: Readonly<Record<CommandRunStatus, string>> = {
  running: 'இயங்குகிறது',
  passed: 'வெற்றி',
  failed: 'தோல்வி',
  timeout: 'நேரம் கடந்தது',
  error: 'இயக்க முடியவில்லை',
};
