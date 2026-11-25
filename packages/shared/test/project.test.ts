import { describe, expect, it } from 'vitest';
import { ProjectCreateSchema, TaskCreateSchema } from '../src/index.js';

describe('ProjectCreateSchema', () => {
  it('trims and applies defaults', () => {
    expect(ProjectCreateSchema.parse({ name: '  POS  ' })).toEqual({
      name: 'POS',
      description: '',
      techStack: [],
      workspacePath: '',
      commands: {},
    });
  });

  it('accepts owner commands as argument lists only', () => {
    const ok = ProjectCreateSchema.parse({ name: 'x', commands: { test: ['pnpm', 'test'] } });
    expect(ok.commands.test).toEqual(['pnpm', 'test']);
    expect(ProjectCreateSchema.safeParse({ name: 'x', commands: { test: [] } }).success).toBe(
      false,
    );
    expect(ProjectCreateSchema.safeParse({ name: 'x', commands: { deploy: ['x'] } }).success).toBe(
      false,
    );
    expect(ProjectCreateSchema.safeParse({ name: 'x', commands: { test: ['a\nb'] } }).success).toBe(
      false,
    );
  });

  it('rejects empty names, control characters and oversized input', () => {
    expect(ProjectCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(ProjectCreateSchema.safeParse({ name: 'a\u0000b' }).success).toBe(false);
    expect(ProjectCreateSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(
      ProjectCreateSchema.safeParse({ name: 'ok', techStack: Array(21).fill('ts') }).success,
    ).toBe(false);
  });

  it('accepts Tamil text and Windows paths', () => {
    const r = ProjectCreateSchema.parse({ name: 'கணக்கியல்', workspacePath: 'C:\\code\\pos' });
    expect(r.workspacePath).toBe('C:\\code\\pos');
  });
});

describe('TaskCreateSchema', () => {
  it('requires a title', () => {
    expect(TaskCreateSchema.safeParse({ title: '' }).success).toBe(false);
    expect(TaskCreateSchema.parse({ title: 'Login page' }).description).toBe('');
  });
});
