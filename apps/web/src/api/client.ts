import type { GetScheduleResponse } from '@scanflow/contracts';

/**
 * Thin fetch wrapper. Paths are relative so the Vite proxy (and later the
 * reverse proxy) can route `/api` without baking a host into the bundle.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Request failed (${String(response.status)}): ${detail.slice(0, 200)}`,
    );
  }
  return (await response.json()) as T;
}

export function fetchSchedule(date: string): Promise<GetScheduleResponse> {
  const params = new URLSearchParams({ date });
  return apiGet<GetScheduleResponse>(`/api/v1/schedule?${params.toString()}`);
}
