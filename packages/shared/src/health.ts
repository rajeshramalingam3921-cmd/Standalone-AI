/** Shape of GET /api/health, shared by server and web client. */
export interface HealthResponse {
  status: 'ok';
  service: 'thiran-server';
  version: string;
  uptimeSeconds: number;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.status === 'ok' &&
    v.service === 'thiran-server' &&
    typeof v.version === 'string' &&
    typeof v.uptimeSeconds === 'number'
  );
}
