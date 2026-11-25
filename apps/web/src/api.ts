import {
  isHealthResponse,
  type ApiError,
  type HealthResponse,
  type Project,
  type ProjectCreateInput,
  type ProjectSummary,
  type Task,
  type TaskCreateInput,
  type UserTaskAction,
} from '@thiran/shared';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; issues?: { path: string; message: string }[] };

const ERROR_TA: Record<string, string> = {
  validation_error: 'சில விவரங்கள் தவறாக உள்ளன',
  not_found: 'கிடைக்கவில்லை',
  conflict: 'இந்தப் பெயரில் ஏற்கனவே ஒன்று உள்ளது',
  invalid_action: 'இந்த நிலையில் இந்தச் செயல் அனுமதிக்கப்படவில்லை',
  internal_error: 'Server-இல் பிழை ஏற்பட்டது',
};

export async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
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
    const err = (body ?? {}) as Partial<ApiError>;
    const message = (err.error && ERROR_TA[err.error]) || `Server பதில்: HTTP ${res.status}`;
    return { ok: false, message, ...(err.issues && { issues: err.issues }) };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, message: 'Server பதில் தரவில்லை (timeout)' };
    }
    return { ok: false, message: 'Server-ஐ அணுக முடியவில்லை' };
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

export const api = {
  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  getProject: (id: string) => request<Project>(`/api/projects/${enc(id)}`),
  createProject: (input: ProjectCreateInput) =>
    request<Project>('/api/projects', { method: 'POST', body: input }),
  listTasks: (projectId: string) => request<Task[]>(`/api/projects/${enc(projectId)}/tasks`),
  createTask: (projectId: string, input: TaskCreateInput) =>
    request<Task>(`/api/projects/${enc(projectId)}/tasks`, { method: 'POST', body: input }),
  taskAction: (projectId: string, taskId: string, action: UserTaskAction) =>
    request<Task>(`/api/projects/${enc(projectId)}/tasks/${enc(taskId)}/actions`, {
      method: 'POST',
      body: { action },
    }),
};
