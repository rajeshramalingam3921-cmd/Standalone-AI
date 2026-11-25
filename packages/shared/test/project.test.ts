import { describe, expect, it } from 'vitest';
import { ProjectCreateSchema, TaskCreateSchema } from '../src/index.js';

describe('ProjectCreateSchema', () => {
  it('trims and applies defaults', () => {
    expect(ProjectCreateSchema.parse({ name: '  POS  ' })).toEqual({
      name: 'POS',
      description: '',
      techStack: [],
      workspacePath: '',
    });
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
