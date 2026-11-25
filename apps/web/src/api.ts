import {
  isHealthResponse,
  type ApiError,
  type HealthResponse,
  type Project,
  type ProjectCreateInput,
  type ProjectSummary,
  type SessionStatus,
  type Task,
  type TaskCreateInput,
  type UserTaskAction,
  type ChangeSetCreateInput,
  type ChangeSetView,
  type CommandName,
  type CommandRun,
  type FileContent,
  type FileEntry,
  type Project as ProjectT,
  type ProjectUpdateInput,
  type WorkspaceInfo,
  type AiStatus,
  type ChatMessage,
  type ChatSendInput,
  type ChatStreamEvent,
  type Conversation,
} from '@thiran/shared';

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP status, or 0 for network failures/timeouts. */
      status: number;
      code?: string;
      message: string;
      issues?: { path: string; message: string }[];
      /** For files_changed: which files conflict. */
      paths?: string[];
    };

/** Fired when any non-auth request gets 401, so the app can show the login screen. */
export const UNAUTHORIZED_EVENT = 'thiran:unauthorized';

const ERROR_TA: Record<string, string> = {
  validation_error: 'சில விவரங்கள் தவறாக உள்ளன',
  not_found: 'கிடைக்கவில்லை',
  conflict: 'இந்தப் பெயரில் ஏற்கனவே ஒன்று உள்ளது',
  invalid_action: 'இந்த நிலையில் இந்தச் செயல் அனுமதிக்கப்படவில்லை',
  internal_error: 'Server-இல் பிழை ஏற்பட்டது',
  unauthenticated: 'மீண்டும் உள்நுழையவும்',
  invalid_credentials: 'கடவுச்சொல் தவறு',
  rate_limited: 'பல முயற்சிகள் நடந்துள்ளன. சிறிது நேரம் கழித்து முயற்சிக்கவும்',
  setup_required: 'Owner கடவுச்சொல் இன்னும் அமைக்கப்படவில்லை',
  busy: 'இந்த உரையாடலில் ஏற்கனவே ஒரு பதில் உருவாகிக்கொண்டிருக்கிறது',
  ai_not_configured: 'Server-இல் AI provider key அமைக்கப்படவில்லை',
  workspace_unavailable: 'Project folder அணுக முடியவில்லை (Settings-ஐப் பார்க்கவும்)',
  files_changed: 'இதற்கிடையில் சில files மாறியுள்ளன. பாதுகாப்புக்காக எழுதவில்லை',
  no_changes: 'எந்த மாற்றமும் இல்லை',
  invalid_state: 'இந்த நிலையில் இந்தச் செயல் அனுமதிக்கப்படவில்லை',
  command_not_configured: 'இந்த command Settings-இல் அமைக்கப்படவில்லை',
  file_denied: 'இந்த file-ஐப் பாதுகாப்புக் காரணங்களால் அணுக முடியாது',
  file_invalid_path: 'File பாதை தவறானது',
  file_not_found: 'File கிடைக்கவில்லை',
  file_too_large: 'File மிகப் பெரியது (512KB வரம்பு)',
  file_binary: 'இது உரை file அல்ல (binary)',
  file_not_a_file: 'இது file அல்ல',
  file_not_a_directory: 'இது folder அல்ல',
  attempt_limit: 'இந்த task-க்கான முயற்சி வரம்பு முடிந்தது',
  plan_limit: 'இந்த task-க்கான திட்ட வரம்பு முடிந்தது',
  no_plan: 'அனுமதிக்க ஒரு திட்டம் இல்லை',
};

function errorResult(
  path: string,
  status: number,
  body: unknown,
): Extract<Result<never>, { ok: false }> {
  const err = (body ?? {}) as Partial<ApiError>;
  if (status === 401 && !path.startsWith('/api/auth/') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  const message = (err.error && ERROR_TA[err.error]) || `Server பதில்: HTTP ${status}`;
  return {
    ok: false,
    status,
    message,
    ...(err.error && { code: err.error }),
    ...(err.issues && { issues: err.issues }),
    ...(Array.isArray((body as { paths?: unknown })?.paths) && {
      paths: (body as { paths: string[] }).paths,
    }),
  };
}

export async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(path, {
      method: init.method ?? 'GET',
      signal: controller.signal,
      ...(init.body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(init.body),
      }),
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (res.ok) return { ok: true, data: body as T };
    return errorResult(path, res.status, body);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, status: 0, message: 'Server பதில் தரவில்லை (timeout)' };
    }
    return { ok: false, status: 0, message: 'Server-ஐ அணுக முடியவில்லை' };
  } finally {
    clearTimeout(timer);
  }
}

export type HealthResult =
  { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string };

/** Fetch server health. Never throws; returns a displayable result. */
export async function fetchHealth(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<HealthResult> {
  const r = await request<unknown>('/api/health', {}, fetchImpl, timeoutMs);
  if (!r.ok) return { kind: 'error', message: r.message };
  if (!isHealthResponse(r.data)) {
    return { kind: 'error', message: 'Server பதில் தவறான வடிவில் உள்ளது' };
  }
  return { kind: 'ok', data: r.data };
}

const enc = encodeURIComponent;

/**
 * POST a chat message and read the Server-Sent Events reply. Resolves when the
 * stream ends. Aborting (stop button) resolves with { ok: true, stopped: true };
 * the server keeps the partial reply as "stopped".
 */
export async function streamChat(
  projectId: string,
  conversationId: string,
  input: ChatSendInput,
  onEvent: (e: ChatStreamEvent) => void,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<{ stopped: boolean }>> {
  const path = `/api/projects/${enc(projectId)}/conversations/${enc(conversationId)}/messages`;
  try {
    const res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
    if (!res.ok || !res.body) {
      return errorResult(path, res.status, await res.json().catch(() => undefined));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.startsWith('data: ')) onEvent(JSON.parse(chunk.slice(6)) as ChatStreamEvent);
      }
    }
    return { ok: true, data: { stopped: false } };
  } catch (err) {
    if (signal.aborted) return { ok: true, data: { stopped: true } };
    void err;
    return { ok: false, status: 0, message: 'இணைப்பு துண்டிக்கப்பட்டது' };
  }
}

export const api = {
  session: () => request<SessionStatus>('/api/auth/session'),
  login: (password: string) =>
    request<SessionStatus>('/api/auth/login', { method: 'POST', body: { password } }),
  logout: () => request<SessionStatus>('/api/auth/logout', { method: 'POST', body: {} }),
  aiStatus: () => request<AiStatus>('/api/ai/status'),
  updateProject: (id: string, patch: ProjectUpdateInput) =>
    request<ProjectT>(`/api/projects/${enc(id)}`, { method: 'PATCH', body: patch }),
  workspace: (id: string) => request<WorkspaceInfo>(`/api/projects/${enc(id)}/workspace`),
  listFiles: (id: string, dir: string) =>
    request<FileEntry[]>(`/api/projects/${enc(id)}/files?dir=${enc(dir)}`),
  readFile: (id: string, path: string) =>
    request<FileContent>(`/api/projects/${enc(id)}/file?path=${enc(path)}`),
  listChanges: (id: string) => request<ChangeSetView[]>(`/api/projects/${enc(id)}/changes`),
  getChange: (id: string, changeId: string) =>
    request<ChangeSetView>(`/api/projects/${enc(id)}/changes/${enc(changeId)}`),
  createChange: (id: string, input: ChangeSetCreateInput) =>
    request<ChangeSetView>(`/api/projects/${enc(id)}/changes`, { method: 'POST', body: input }),
  changeAction: (id: string, changeId: string, action: 'apply' | 'reject' | 'revert') =>
    request<ChangeSetView>(`/api/projects/${enc(id)}/changes/${enc(changeId)}/${action}`, {
      method: 'POST',
      body: {},
    }),
  listRuns: (id: string) => request<CommandRun[]>(`/api/projects/${enc(id)}/runs`),
  startRun: (id: string, name: CommandName) =>
    request<CommandRun>(`/api/projects/${enc(id)}/runs`, { method: 'POST', body: { name } }),
  listConversations: (projectId: string) =>
    request<Conversation[]>(`/api/projects/${enc(projectId)}/conversations`),
  createConversation: (projectId: string, model?: string) =>
    request<Conversation>(`/api/projects/${enc(projectId)}/conversations`, {
      method: 'POST',
      body: model ? { model } : {},
    }),
  listMessages: (projectId: string, conversationId: string) =>
    request<ChatMessage[]>(
      `/api/projects/${enc(projectId)}/conversations/${enc(conversationId)}/messages`,
    ),
  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  getProject: (id: string) => request<Project>(`/api/projects/${enc(id)}`),
  createProject: (input: ProjectCreateInput) =>
    request<Project>('/api/projects', { method: 'POST', body: input }),
  listTasks: (projectId: string) => request<Task[]>(`/api/projects/${enc(projectId)}/tasks`),
  createTask: (projectId: string, input: TaskCreateInput) =>
    request<Task>(`/api/projects/${enc(projectId)}/tasks`, { method: 'POST', body: input }),
  taskAction: (projectId: string, taskId: string, action: UserTaskAction, feedback?: string) =>
    request<Task>(`/api/projects/${enc(projectId)}/tasks/${enc(taskId)}/actions`, {
      method: 'POST',
      body: feedback ? { action, feedback } : { action },
    }),
};
