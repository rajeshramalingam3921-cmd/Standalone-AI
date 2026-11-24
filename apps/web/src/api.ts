import { isHealthResponse, type HealthResponse } from '@thiran/shared';

export type HealthResult =
  { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string };

/** Fetch server health with a timeout. Never throws; returns a displayable result. */
export async function fetchHealth(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/health', { signal: controller.signal });
    if (!res.ok) return { kind: 'error', message: `Server பதில்: HTTP ${res.status}` };
    const body: unknown = await res.json();
    if (!isHealthResponse(body))
      return { kind: 'error', message: 'Server பதில் தவறான வடிவில் உள்ளது' };
    return { kind: 'ok', data: body };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'error', message: 'Server பதில் தரவில்லை (timeout)' };
    }
    return { kind: 'error', message: 'Server-ஐ அணுக முடியவில்லை' };
  } finally {
    clearTimeout(timer);
  }
}
