import type {
  AppointmentDetail,
  AppointmentTemplateDetail,
  BookAppointmentBody,
  BookAppointmentResponse,
  CandidateDto,
  CreatePatientBody,
  CurrentUser,
  GetScheduleResponse,
  GetResourceAvailabilityResponse,
  ListAuditResponse,
  ListAppointmentsResponse,
  LoginBody,
  PatientDto,
  ProblemDetails,
  RescheduleAppointmentBody,
  ResourceDto,
  SetResourceDayAvailabilityBody,
  ServiceTypeDto,
  SessionResponse,
  SuggestAppointmentsBody,
  SuggestAppointmentsResponse,
} from '@scanflow/contracts';
import { problemDetailsSchema } from '@scanflow/contracts';

import { getAccessToken, setAccessToken } from '../auth/access-token';

/**
 * Thin fetch wrapper. Paths are relative so the Vite proxy (and later the
 * reverse proxy) can route `/api` without baking a host into the bundle.
 *
 * Every call carries the in-memory access token, and a 401 triggers exactly one
 * refresh-and-retry. `pendingRefresh` collapses the stampede that would
 * otherwise happen when a token expires while six queries are in flight.
 */
let pendingRefresh: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  pendingRefresh ??= (async () => {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        setAccessToken(null);
        return false;
      }
      const session = (await response.json()) as SessionResponse;
      setAccessToken(session.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      // Cleared in a microtask so concurrent callers all see this attempt.
      queueMicrotask(() => {
        pendingRefresh = null;
      });
    }
  })();
  return pendingRefresh;
}

async function request<T>(
  path: string,
  init: RequestInit,
  retryOn401 = true,
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && retryOn401) {
    const refreshed = await refreshOnce();
    if (refreshed) return request<T>(path, init, false);
  }

  return parseJsonResponse<T>(response);
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  return request<T>(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function login(body: LoginBody): Promise<SessionResponse> {
  const session = await request<SessionResponse>(
    '/api/v1/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    // A failed sign-in must not trigger a refresh attempt.
    false,
  );
  setAccessToken(session.accessToken);
  return session;
}

/** Restores a session from the refresh cookie. Returns null when there is none. */
export async function restoreSession(): Promise<SessionResponse | null> {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    setAccessToken(null);
    return null;
  }
  const session = (await response.json()) as SessionResponse;
  setAccessToken(session.accessToken);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } finally {
    setAccessToken(null);
  }
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return apiGet<CurrentUser>('/api/v1/auth/me');
}

/** Typed problem+json failure from the API (including 409 with freshCandidates). */
export class ApiProblemError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail);
    this.name = 'ApiProblemError';
    this.status = status;
    this.problem = problem;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const raw: unknown = await response.json().catch(() => null);
  const parsed = problemDetailsSchema.safeParse(raw);
  if (parsed.success) {
    throw new ApiProblemError(response.status, parsed.data);
  }
  throw new Error(
    `Request failed (${String(response.status)}): ${JSON.stringify(raw).slice(0, 200)}`,
  );
}

export function fetchSchedule(date: string): Promise<GetScheduleResponse> {
  const params = new URLSearchParams({ date });
  return apiGet<GetScheduleResponse>(`/api/v1/schedule?${params.toString()}`);
}

export function searchPatients(
  q: string,
  limit = 20,
): Promise<{ items: PatientDto[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q.trim() !== '') params.set('q', q.trim());
  return apiGet<{ items: PatientDto[] }>(
    `/api/v1/patients?${params.toString()}`,
  );
}

export function createPatient(body: CreatePatientBody): Promise<PatientDto> {
  return apiPost<PatientDto>('/api/v1/patients', body);
}

export function fetchServiceTypes(): Promise<{ items: ServiceTypeDto[] }> {
  return apiGet<{ items: ServiceTypeDto[] }>('/api/v1/service-types');
}

export function fetchResources(): Promise<{ items: ResourceDto[] }> {
  return apiGet<{ items: ResourceDto[] }>('/api/v1/resources');
}

export function fetchTemplateSummaries(): Promise<{
  items: {
    id: string;
    code: string;
    name: string;
    isPreset: boolean;
    active: boolean;
  }[];
}> {
  return apiGet('/api/v1/appointment-templates');
}

export function fetchTemplate(id: string): Promise<AppointmentTemplateDetail> {
  return apiGet<AppointmentTemplateDetail>(
    `/api/v1/appointment-templates/${id}`,
  );
}

export function suggestAppointments(
  body: SuggestAppointmentsBody,
): Promise<SuggestAppointmentsResponse> {
  return apiPost<SuggestAppointmentsResponse>(
    '/api/v1/appointments/suggestions',
    body,
  );
}

export function bookAppointment(
  body: BookAppointmentBody,
  idempotencyKey: string,
): Promise<BookAppointmentResponse> {
  return apiPost<BookAppointmentResponse>('/api/v1/appointments', body, {
    idempotencyKey,
  });
}

export function fetchAppointment(id: string): Promise<AppointmentDetail> {
  return apiGet<AppointmentDetail>(`/api/v1/appointments/${id}`);
}

export type StatusActionPath =
  'cancel' | 'check-in' | 'undo-check-in' | 'no-show' | 'start' | 'complete';

export function listAppointments(params: {
  q?: string;
  date?: string;
  patientId?: string;
  limit?: number;
}): Promise<ListAppointmentsResponse> {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q.trim() !== '') {
    search.set('q', params.q.trim());
  }
  if (params.date !== undefined) search.set('date', params.date);
  if (params.patientId !== undefined) search.set('patientId', params.patientId);
  search.set('limit', String(params.limit ?? 20));
  return apiGet<ListAppointmentsResponse>(
    `/api/v1/appointments?${search.toString()}`,
  );
}

/** ADMIN-only clinic activity trail. */
export function fetchAudit(limit = 50): Promise<ListAuditResponse> {
  return apiGet<ListAuditResponse>(`/api/v1/audit?limit=${String(limit)}`);
}

export function fetchResourceAvailability(
  resourceId: string,
  date: string,
): Promise<GetResourceAvailabilityResponse> {
  return apiGet(
    `/api/v1/resources/${resourceId}/availability?date=${encodeURIComponent(date)}`,
  );
}

export function setResourceAvailability(
  resourceId: string,
  body: SetResourceDayAvailabilityBody,
): Promise<GetResourceAvailabilityResponse> {
  return apiPut(`/api/v1/resources/${resourceId}/availability`, body);
}

export function fetchPatient(id: string): Promise<PatientDto> {
  return apiGet<PatientDto>(`/api/v1/patients/${id}`);
}

export function postAppointmentStatus(
  appointmentId: string,
  path: StatusActionPath,
  body: { reason?: string } = {},
): Promise<{
  appointmentId: string;
  status: string;
  scheduleVersion: number;
}> {
  return apiPost(`/api/v1/appointments/${appointmentId}/${path}`, body);
}

export function rescheduleAppointment(
  appointmentId: string,
  body: RescheduleAppointmentBody,
  idempotencyKey: string,
): Promise<BookAppointmentResponse> {
  return apiPost(`/api/v1/appointments/${appointmentId}/reschedule`, body, {
    idempotencyKey,
  });
}

export type { CandidateDto };
