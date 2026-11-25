import { AgentPlanSchema, type AgentPlan, type CommandName } from '@thiran/shared';
import { z } from 'zod';
import type { AgentToolResult, AgentToolSpec } from '../ai/types.js';
import { MAX_WRITE_BYTES, WorkspaceError, checkWritablePath, type Workspace } from './workspace.js';

export const MAX_STAGED_FILES = 20;
const MAX_TOOL_OUTPUT = 60_000;
const SEARCH_MAX_FILES = 2000;
const SEARCH_MAX_MATCHES = 100;

const clip = (s: string) =>
  s.length > MAX_TOOL_OUTPUT ? `${s.slice(0, MAX_TOOL_OUTPUT)}\n[… output clipped]` : s;

const str = (description: string) => ({ type: 'string', description });

const READ_TOOLS: AgentToolSpec[] = [
  {
    name: 'list_files',
    description:
      'List a folder of the project. Use "" for the project root. Secret files and generated folders are hidden.',
    inputSchema: {
      type: 'object',
      properties: { path: str('Folder path relative to the project root, using "/". "" = root.') },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file of the project (max 512 KB).',
    inputSchema: {
      type: 'object',
      properties: { path: str('File path relative to the project root, using "/".') },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description:
      'Case-insensitive text search across project text files. Returns "path:line: text" matches (max 100).',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Text to look for (2-200 characters).'),
        path: str('Folder to search in ("" = whole project).'),
      },
      required: ['query', 'path'],
      additionalProperties: false,
    },
  },
];

const PLAN_TOOL: AgentToolSpec = {
  name: 'submit_plan',
  description:
    'Submit the final plan for the owner to approve. Call exactly once, after reading the relevant files. Nothing is changed by planning.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: str('What will be done and why, in simple Tamil.'),
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered steps, in simple Tamil.',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files that will be created or changed.',
      },
      checks: {
        type: 'array',
        items: { type: 'string', enum: ['build', 'test', 'lint'] },
        description: 'Owner-configured checks that should verify the change.',
      },
    },
    required: ['summary', 'steps', 'files', 'checks'],
    additionalProperties: false,
  },
};

const WRITE_TOOLS: AgentToolSpec[] = [
  {
    name: 'write_file',
    description:
      'Propose the COMPLETE new content of one file (create or replace). Nothing is written to disk: all proposals become one change set the owner reviews as a diff. Calling again for the same path replaces the proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        path: str('File path relative to the project root, using "/".'),
        content: str('Full new file content.'),
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'finish',
    description:
      'Call once when all changes are proposed. Give a short summary for the owner in simple Tamil.',
    inputSchema: {
      type: 'object',
      properties: { summary_ta: str('What was changed and why, in simple Tamil (max ~10 lines).') },
      required: ['summary_ta'],
      additionalProperties: false,
    },
  },
];

const PathInput = z.object({ path: z.string().max(400) }).strict();
const SearchInput = z
  .object({ query: z.string().min(2).max(200), path: z.string().max(400) })
  .strict();
const WriteInput = z.object({ path: z.string().min(1).max(400), content: z.string() }).strict();
const FinishInput = z.object({ summary_ta: z.string().min(1).max(4000) }).strict();

export interface ToolSession {
  specs: AgentToolSpec[];
  execute: (name: string, input: unknown) => Promise<AgentToolResult>;
  /** Plan submitted (plan mode). */
  plan?: AgentPlan;
  /** Proposed full-file contents (execute mode). */
  staged: Map<string, string>;
  summary?: string;
}

function errorText(e: unknown): string {
  if (e instanceof WorkspaceError) {
    const why: Record<string, string> = {
      denied: 'access denied by policy (secret, VCS or generated file)',
      invalid_path: 'invalid path (use a relative path with "/", no "..")',
      not_found: 'not found',
      too_large: 'file too large (512 KB limit)',
      binary: 'not a UTF-8 text file',
      not_a_file: 'not a file',
      not_a_directory: 'not a folder',
    };
    return `Error: ${why[e.code] ?? e.code}`;
  }
  throw e;
}

/**
 * Tools for one agent run. `plan` mode is read-only + submit_plan; `execute` mode is
 * read-only + write_file (staging only) + finish. `onTool` receives a one-line log entry.
 */
export function createToolSession(
  ws: Workspace,
  mode: 'plan' | 'execute',
  configuredChecks: CommandName[],
  onTool: (line: string) => void,
): ToolSession {
  const session: ToolSession = {
    specs: [...READ_TOOLS, ...(mode === 'plan' ? [PLAN_TOOL] : WRITE_TOOLS)],
    staged: new Map(),
    execute: async (name, input) => {
      try {
        switch (name) {
          case 'list_files': {
            const { path } = PathInput.parse(input);
            onTool(`📁 list_files ${path || '/'}`);
            const entries = await ws.list(path);
            return {
              content: clip(
                entries
                  .map(
                    (e) =>
                      `${e.type === 'dir' ? 'dir ' : 'file'} ${e.path}${e.size !== null ? ` (${e.size} B)` : ''}`,
                  )
                  .join('\n') || '(empty folder)',
              ),
            };
          }
          case 'read_file': {
            const { path } = PathInput.parse(input);
            onTool(`📄 read_file ${path}`);
            const staged = session.staged.get(path);
            if (staged !== undefined)
              return { content: clip(`[proposed version, not yet written]\n${staged}`) };
            return { content: clip((await ws.read(path)).content) };
          }
          case 'search_files': {
            const { query, path } = SearchInput.parse(input);
            onTool(`🔎 search_files "${query}"`);
            const q = query.toLowerCase();
            const matches: string[] = [];
            const queue = [path];
            let files = 0;
            while (
              queue.length &&
              files < SEARCH_MAX_FILES &&
              matches.length < SEARCH_MAX_MATCHES
            ) {
              const dir = queue.shift()!;
              for (const e of await ws.list(dir).catch(() => [])) {
                if (e.type === 'dir') queue.push(e.path);
                else if (++files <= SEARCH_MAX_FILES) {
                  const text = await ws
                    .read(e.path)
                    .then((f) => f.content)
                    .catch(() => null);
                  if (!text) continue;
                  text.split('\n').forEach((line, i) => {
                    if (matches.length < SEARCH_MAX_MATCHES && line.toLowerCase().includes(q)) {
                      matches.push(`${e.path}:${i + 1}: ${line.trim().slice(0, 200)}`);
                    }
                  });
                }
              }
            }
            return { content: matches.join('\n') || 'No matches.' };
          }
          case 'submit_plan': {
            if (mode !== 'plan') break;
            const parsed = AgentPlanSchema.safeParse(input);
            if (!parsed.success) {
              return {
                content: `Invalid plan: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
                isError: true,
              };
            }
            for (const f of parsed.data.files) checkWritablePath(f);
            // Only checks the owner actually configured can be planned.
            session.plan = {
              ...parsed.data,
              checks: parsed.data.checks.filter((c) => configuredChecks.includes(c)),
            };
            onTool('📝 submit_plan');
            return { content: 'Plan submitted for owner approval.', stop: true };
          }
          case 'write_file': {
            if (mode !== 'execute') break;
            const { path, content } = WriteInput.parse(input);
            const clean = checkWritablePath(path);
            if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES)
              throw new WorkspaceError('too_large');
            if (!session.staged.has(clean) && session.staged.size >= MAX_STAGED_FILES) {
              return {
                content: `Error: at most ${MAX_STAGED_FILES} files per change.`,
                isError: true,
              };
            }
            session.staged.set(clean, content);
            onTool(`✏️ write_file ${clean} (proposed)`);
            return {
              content: `Proposed new content for ${clean}. Not written yet; the owner will review it.`,
            };
          }
          case 'finish': {
            if (mode !== 'execute') break;
            session.summary = FinishInput.parse(input).summary_ta;
            onTool('✅ finish');
            return { content: 'Done. The owner will review the proposed changes.', stop: true };
          }
        }
        return { content: `Unknown tool: ${name}`, isError: true };
      } catch (e) {
        if (e instanceof z.ZodError) {
          return {
            content: `Invalid input: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
            isError: true,
          };
        }
        return { content: errorText(e), isError: true };
      }
    },
  };
  return session;
}
