import { randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import type { ChangeFile, ChangeSet, ChangeSetView } from '@thiran/shared';
import { WorkspaceError, sha256, type Workspace } from './workspace.js';

export class ChangeConflictError extends Error {
  constructor(readonly paths: string[]) {
    super('Files changed since the change set was prepared.');
    this.name = 'ChangeConflictError';
  }
}

export class NoChangesError extends Error {
  constructor() {
    super('No differences.');
    this.name = 'NoChangesError';
  }
}

const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/**
 * Build a change set from proposed full-file contents. Reads the current files to
 * record what they were (for diffs, conflict checks and rollback). Nothing is written.
 */
export async function prepareChangeSet(
  ws: Workspace,
  input: {
    projectId: string;
    title: string;
    source: 'user' | 'agent';
    taskId?: string | null;
    files: { path: string; content: string; baseSha256?: string | null | undefined }[];
  },
  now: Date,
): Promise<ChangeSet> {
  const seen = new Set<string>();
  const files: ChangeFile[] = [];
  let total = 0;
  const conflicts: string[] = [];

  for (const f of input.files) {
    if (seen.has(f.path)) throw new WorkspaceError('invalid_path');
    seen.add(f.path);
    total += Buffer.byteLength(f.content, 'utf8');
    if (total > MAX_TOTAL_BYTES) throw new WorkspaceError('too_large');

    let original: { content: string; sha256: string } | null = null;
    try {
      original = await ws.read(f.path);
    } catch (e) {
      if (!(e instanceof WorkspaceError && e.code === 'not_found')) throw e;
    }
    // The editor saw a different version than what is on disk now.
    if (f.baseSha256 !== undefined && f.baseSha256 !== (original?.sha256 ?? null)) {
      conflicts.push(f.path);
      continue;
    }
    if (original && original.content === f.content) continue; // unchanged
    files.push({
      path: f.path,
      action: original ? 'modify' : 'create',
      baseSha256: original?.sha256 ?? null,
      originalContent: original?.content ?? null,
      newContent: f.content,
      newSha256: sha256(f.content),
    });
  }
  if (conflicts.length) throw new ChangeConflictError(conflicts);
  if (files.length === 0) throw new NoChangesError();

  return {
    id: randomUUID(),
    projectId: input.projectId,
    title: input.title,
    source: input.source,
    taskId: input.taskId ?? null,
    status: 'pending',
    files,
    createdAt: now.toISOString(),
    decidedAt: null,
  };
}

export function toView(cs: ChangeSet): ChangeSetView {
  return {
    ...cs,
    files: cs.files.map((f) => {
      const diff = createTwoFilesPatch(
        f.action === 'create' ? '/dev/null' : `a/${f.path}`,
        `b/${f.path}`,
        f.originalContent ?? '',
        f.newContent,
        '',
        '',
        { context: 3 },
      );
      const all = diff.split('\n');
      const lines = all.slice(
        Math.max(
          0,
          all.findIndex((l) => l.startsWith('@@')),
        ),
      );
      return {
        path: f.path,
        action: f.action,
        diff,
        additions: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        deletions: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
      };
    }),
  };
}

/**
 * Write a change set to disk. Every file must still be exactly as it was when the
 * change was prepared (no silent overwrite of edits made in the meantime). If a
 * write fails part-way, already-written files are restored.
 */
export async function applyChangeSet(ws: Workspace, cs: ChangeSet): Promise<void> {
  const conflicts: string[] = [];
  for (const f of cs.files) {
    if ((await ws.hashOf(f.path)) !== f.baseSha256) conflicts.push(f.path);
  }
  if (conflicts.length) throw new ChangeConflictError(conflicts);

  const done: ChangeFile[] = [];
  try {
    for (const f of cs.files) {
      await ws.write(f.path, f.newContent);
      done.push(f);
    }
  } catch (e) {
    for (const f of done.reverse()) {
      if (f.originalContent === null) await ws.remove(f.path).catch(() => undefined);
      else await ws.write(f.path, f.originalContent).catch(() => undefined);
    }
    throw e;
  }
}

/** Undo an applied change set, only if none of its files were edited afterwards. */
export async function revertChangeSet(ws: Workspace, cs: ChangeSet): Promise<void> {
  const conflicts: string[] = [];
  for (const f of cs.files) {
    if ((await ws.hashOf(f.path)) !== f.newSha256) conflicts.push(f.path);
  }
  if (conflicts.length) throw new ChangeConflictError(conflicts);
  for (const f of [...cs.files].reverse()) {
    if (f.originalContent === null) await ws.remove(f.path);
    else await ws.write(f.path, f.originalContent);
  }
}
