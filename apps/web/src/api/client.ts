import type {
  AppointmentTemplateDetail,
  BookAppointmentBody,
  BookAppointmentResponse,
  CandidateDto,
  CreatePatientBody,
  GetScheduleResponse,
  PatientDto,
  ProblemDetails,
  ResourceDto,
  ServiceTypeDto,
  SuggestAppointmentsBody,
  SuggestAppointmentsResponse,
} from '@scanflow/contracts';
import { problemDetailsSchema } from '@scanflow/contracts';

/**
 * Thin fetch wrapper. Paths are relative so the Vite proxy (and later the
 * reverse proxy) can route `/api` without baking a host into the bundle.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse<T>(response);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
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

export type { CandidateDto };
