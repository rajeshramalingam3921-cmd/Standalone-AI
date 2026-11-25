import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreCorruptError } from '../src/store/errors.js';
import { createJsonFileStore } from '../src/store/json-file-store.js';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thiran-store-'));
  file = join(dir, 'nested', 'thiran.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const project = (name: string) => ({ name, description: '', techStack: [], workspacePath: '' });

describe('JSON file store', () => {
  it('persists projects and tasks across restarts', async () => {
    const s1 = await createJsonFileStore({ file });
    const p = await s1.createProject(project('POS'));
    const t = await s1.createTask(p.id, { title: 'Billing screen', description: '' });

    const s2 = await createJsonFileStore({ file });
    expect(await s2.getProject(p.id)).toEqual(p);
    expect(await s2.getTask(p.id, t.id)).toEqual(t);
  });

  it('writes the data file with owner-only permissions', async () => {
    const s = await createJsonFileStore({ file });
    await s.createProject(project('POS'));
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('refuses to start on a corrupt file and leaves it untouched', async () => {
    const s = await createJsonFileStore({ file });
    await s.createProject(project('POS'));
    await writeFile(file, '{ broken');
    await expect(createJsonFileStore({ file })).rejects.toBeInstanceOf(StoreCorruptError);
    expect(await readFile(file, 'utf8')).toBe('{ broken');
  });

  it('does not let callers mutate stored state through returned objects', async () => {
    const s = await createJsonFileStore({ file: null });
    const p = await s.createProject(project('P'));
    (await s.listProjects())[0]!.name = 'hacked';
    expect((await s.getProject(p.id))?.name).toBe('P');
  });

  it('reads Phase 3 files that have no owner/sessions fields', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, projects: [], tasks: [] }));
    const s = await createJsonFileStore({ file });
    expect(await s.getOwnerPasswordHash()).toBeUndefined();
  });

  it('serializes concurrent writes without losing data', async () => {
    const s = await createJsonFileStore({ file });
    const p = await s.createProject(project('P'));
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => s.createTask(p.id, { title: `t${i}`, description: '' })),
    );
    const reloaded = await createJsonFileStore({ file });
    expect(await reloaded.listTasks(p.id)).toHaveLength(25);
  });
});
