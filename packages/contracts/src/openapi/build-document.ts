import './init.js';

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { appointmentStatusSchema } from '../enums.js';
import {
  appointmentTemplateDetailSchema,
  appointmentTemplateSummarySchema,
  bookAppointmentBodySchema,
  bookAppointmentResponseSchema,
  cancelAppointmentBodySchema,
  createAppointmentTemplateBodySchema,
  createPatientBodySchema,
  currentUserSchema,
  getResourceAvailabilityResponseSchema,
  getScheduleQuerySchema,
  getScheduleResponseSchema,
  healthResponseSchema,
  listAppointmentsQuerySchema,
  listAppointmentsResponseSchema,
  listAuditQuerySchema,
  listAuditResponseSchema,
  listPatientsQuerySchema,
  loginBodySchema,
  patientSchema,
  problemDetailsSchema,
  readyResponseSchema,
  rescheduleAppointmentBodySchema,
  resourceDtoSchema,
  serviceTypeDtoSchema,
  sessionResponseSchema,
  setResourceDayAvailabilityBodySchema,
  suggestAppointmentsBodySchema,
  suggestAppointmentsResponseSchema,
  appointmentDetailSchema,
} from '../http/schemas.js';

/**
 * OpenAPI is derived from the same Zod schemas that validate live traffic
 * (ADR 0002 reversal path). Paths are registered here because route metadata
 * (RBAC, SSE, cookies) lives in Express, not in contracts.
 */
export function buildOpenApiDocument(): ReturnType<
  OpenApiGeneratorV31['generateDocument']
> {
  const registry = new OpenAPIRegistry();

  const HealthResponse = registry.register(
    'HealthResponse',
    healthResponseSchema,
  );
  const ReadyResponse = registry.register('ReadyResponse', readyResponseSchema);
  const LoginBody = registry.register('LoginBody', loginBodySchema);
  const SessionResponse = registry.register(
    'SessionResponse',
    sessionResponseSchema,
  );
  const CurrentUser = registry.register('CurrentUser', currentUserSchema);
  const ProblemDetails = registry.register(
    'ProblemDetails',
    problemDetailsSchema,
  );
  const GetScheduleQuery = registry.register(
    'GetScheduleQuery',
    getScheduleQuerySchema,
  );
  const GetScheduleResponse = registry.register(
    'GetScheduleResponse',
    getScheduleResponseSchema,
  );
  const SuggestAppointmentsBody = registry.register(
    'SuggestAppointmentsBody',
    suggestAppointmentsBodySchema,
  );
  const SuggestAppointmentsResponse = registry.register(
    'SuggestAppointmentsResponse',
    suggestAppointmentsResponseSchema,
  );
  const BookAppointmentBody = registry.register(
    'BookAppointmentBody',
    bookAppointmentBodySchema,
  );
  const BookAppointmentResponse = registry.register(
    'BookAppointmentResponse',
    bookAppointmentResponseSchema,
  );
  const ListAppointmentsQuery = registry.register(
    'ListAppointmentsQuery',
    listAppointmentsQuerySchema,
  );
  const ListAppointmentsResponse = registry.register(
    'ListAppointmentsResponse',
    listAppointmentsResponseSchema,
  );
  const AppointmentDetail = registry.register(
    'AppointmentDetail',
    appointmentDetailSchema,
  );
  const RescheduleAppointmentBody = registry.register(
    'RescheduleAppointmentBody',
    rescheduleAppointmentBodySchema,
  );
  const CancelAppointmentBody = registry.register(
    'CancelAppointmentBody',
    cancelAppointmentBodySchema,
  );
  const ChangeStatusResponse = registry.register(
    'ChangeStatusResponse',
    z.object({
      appointmentId: z.uuid(),
      status: appointmentStatusSchema,
      scheduleVersion: z.number().int().positive(),
    }),
  );
  const ListPatientsQuery = registry.register(
    'ListPatientsQuery',
    listPatientsQuerySchema,
  );
  const Patient = registry.register('Patient', patientSchema);
  const CreatePatientBody = registry.register(
    'CreatePatientBody',
    createPatientBodySchema,
  );
  const Resource = registry.register('Resource', resourceDtoSchema);
  const GetResourceAvailabilityResponse = registry.register(
    'GetResourceAvailabilityResponse',
    getResourceAvailabilityResponseSchema,
  );
  const SetResourceDayAvailabilityBody = registry.register(
    'SetResourceDayAvailabilityBody',
    setResourceDayAvailabilityBodySchema,
  );
  const ServiceType = registry.register('ServiceType', serviceTypeDtoSchema);
  const AppointmentTemplateSummary = registry.register(
    'AppointmentTemplateSummary',
    appointmentTemplateSummarySchema,
  );
  const AppointmentTemplateDetail = registry.register(
    'AppointmentTemplateDetail',
    appointmentTemplateDetailSchema,
  );
  const CreateAppointmentTemplateBody = registry.register(
    'CreateAppointmentTemplateBody',
    createAppointmentTemplateBodySchema,
  );
  const ListAuditQuery = registry.register(
    'ListAuditQuery',
    listAuditQuerySchema,
  );
  const ListAuditResponse = registry.register(
    'ListAuditResponse',
    listAuditResponseSchema,
  );

  const ItemsOf = <T extends z.ZodType>(item: T, name: string) =>
    registry.register(
      name,
      z.object({
        items: z.array(item),
      }),
    );

  const ResourceList = ItemsOf(Resource, 'ResourceList');
  const PatientList = ItemsOf(Patient, 'PatientList');
  const ServiceTypeList = ItemsOf(ServiceType, 'ServiceTypeList');
  const TemplateList = ItemsOf(
    AppointmentTemplateSummary,
    'AppointmentTemplateList',
  );

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Access token from POST /auth/login. Send as Authorization: Bearer <token>.',
  });

  const bearer = [{ bearerAuth: [] as string[] }];

  const json = <T extends z.ZodType>(schema: T) => ({
    content: { 'application/json': { schema } },
  });

  const problem = (description: string) => ({
    description,
    content: { 'application/problem+json': { schema: ProblemDetails } },
  });

  const idempotencyHeaders = z.object({
    'Idempotency-Key': z
      .string()
      .max(128)
      .optional()
      .describe(
        'Optional replay key. Same key + same body replays the original response; same key + different body returns 409.',
      ),
  });

  // -------------------------------------------------------------------------
  // Health (no auth)
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Liveness probe',
    responses: {
      200: { description: 'Process is running.', ...json(HealthResponse) },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/ready',
    tags: ['Health'],
    summary: 'Readiness probe',
    description:
      'Checks database connectivity. Returns 503 when Postgres is down.',
    responses: {
      200: { description: 'Ready to serve traffic.', ...json(ReadyResponse) },
      503: problem('Database unreachable.'),
    },
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'post',
    path: '/auth/login',
    tags: ['Auth'],
    summary: 'Sign in',
    request: { body: { ...json(LoginBody), required: true } },
    responses: {
      200: {
        description:
          'Session issued. Refresh token is set as httpOnly cookie `scanflow_refresh`.',
        ...json(SessionResponse),
      },
      401: problem('Invalid credentials.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/refresh',
    tags: ['Auth'],
    summary: 'Rotate session',
    description: 'Uses the httpOnly refresh cookie; no request body.',
    responses: {
      200: { description: 'New access token.', ...json(SessionResponse) },
      401: problem('Missing or expired refresh cookie.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/logout',
    tags: ['Auth'],
    summary: 'Sign out',
    responses: { 204: { description: 'Refresh cookie cleared.' } },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/me',
    tags: ['Auth'],
    summary: 'Current user',
    security: bearer,
    responses: {
      200: { description: 'Authenticated profile.', ...json(CurrentUser) },
      401: problem('Missing or invalid access token.'),
    },
  });

  // -------------------------------------------------------------------------
  // Schedule
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/schedule',
    tags: ['Schedule'],
    summary: 'Day schedule grid',
    security: bearer,
    request: { query: GetScheduleQuery },
    responses: {
      200: {
        description: 'Lanes, segments, and availability.',
        ...json(GetScheduleResponse),
      },
      401: problem('Unauthenticated.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/schedule/stream',
    tags: ['Schedule'],
    summary: 'Schedule change stream (SSE)',
    security: bearer,
    description:
      'Server-sent events when the day schedule changes. Connect with EventSource; reconnect with Last-Event-ID.',
    responses: {
      200: {
        description: 'text/event-stream of scheduleVersion bumps.',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      },
      401: problem('Unauthenticated.'),
    },
  });

  // -------------------------------------------------------------------------
  // Appointments
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'post',
    path: '/appointments/suggestions',
    tags: ['Appointments'],
    summary: 'Rank placement candidates',
    description:
      'RECEPTIONIST and ADMIN only. Engine proposes; never auto-books.',
    security: bearer,
    request: { body: { ...json(SuggestAppointmentsBody), required: true } },
    responses: {
      200: {
        description: 'Up to five ranked candidates.',
        ...json(SuggestAppointmentsResponse),
      },
      401: problem('Unauthenticated.'),
      403: problem('CLINICIAN cannot book.'),
      422: problem('Invalid chain or date.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/appointments',
    tags: ['Appointments'],
    summary: 'Book appointment',
    description:
      'RECEPTIONIST and ADMIN only. Re-validates the chosen candidate server-side.',
    security: bearer,
    request: {
      body: { ...json(BookAppointmentBody), required: true },
      headers: idempotencyHeaders,
    },
    responses: {
      201: { description: 'Booked.', ...json(BookAppointmentResponse) },
      401: problem('Unauthenticated.'),
      403: problem('CLINICIAN cannot book.'),
      409: problem(
        'Slot conflict or stale scheduleVersion; may include freshCandidates.',
      ),
      422: problem('Validation failed.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/appointments',
    tags: ['Appointments'],
    summary: 'List or search appointments',
    security: bearer,
    request: { query: ListAppointmentsQuery },
    responses: {
      200: {
        description: 'Paginated list.',
        ...json(ListAppointmentsResponse),
      },
      401: problem('Unauthenticated.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/appointments/{id}',
    tags: ['Appointments'],
    summary: 'Appointment detail',
    security: bearer,
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      200: { description: 'Full appointment.', ...json(AppointmentDetail) },
      401: problem('Unauthenticated.'),
      404: problem('Not found.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/appointments/{id}/reschedule',
    tags: ['Appointments'],
    summary: 'Move to a new candidate',
    security: bearer,
    request: {
      params: z.object({ id: z.uuid() }),
      body: { ...json(RescheduleAppointmentBody), required: true },
      headers: idempotencyHeaders,
    },
    responses: {
      200: { description: 'Rescheduled.', ...json(BookAppointmentResponse) },
      401: problem('Unauthenticated.'),
      409: problem('Slot conflict or stale scheduleVersion.'),
      404: problem('Not found.'),
    },
  });

  for (const [suffix, summary] of [
    ['cancel', 'Cancel appointment'],
    ['check-in', 'Check in patient'],
    ['undo-check-in', 'Revert check-in to scheduled'],
    ['no-show', 'Mark no-show'],
    ['start', 'Start visit (in progress)'],
    ['complete', 'Complete visit'],
  ] as const) {
    registry.registerPath({
      method: 'post',
      path: `/appointments/{id}/${suffix}`,
      tags: ['Appointments'],
      summary,
      security: bearer,
      request: {
        params: z.object({ id: z.uuid() }),
        ...(suffix === 'cancel'
          ? { body: { ...json(CancelAppointmentBody), required: false } }
          : {}),
      },
      responses: {
        200: { description: 'Status updated.', ...json(ChangeStatusResponse) },
        401: problem('Unauthenticated.'),
        404: problem('Not found.'),
        422: problem('Invalid status transition.'),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Patients
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/patients',
    tags: ['Patients'],
    summary: 'Search patients',
    security: bearer,
    request: { query: ListPatientsQuery },
    responses: {
      200: { description: 'Matching patients.', ...json(PatientList) },
      401: problem('Unauthenticated.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/patients',
    tags: ['Patients'],
    summary: 'Register patient',
    security: bearer,
    request: { body: { ...json(CreatePatientBody), required: true } },
    responses: {
      201: { description: 'Created.', ...json(Patient) },
      401: problem('Unauthenticated.'),
      409: problem('MRN already exists.'),
      422: problem('Validation failed.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/patients/{id}',
    tags: ['Patients'],
    summary: 'Patient detail',
    security: bearer,
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: { description: 'Patient record.', ...json(Patient) },
      401: problem('Unauthenticated.'),
      404: problem('Not found.'),
    },
  });

  // -------------------------------------------------------------------------
  // Resources & availability
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/resources',
    tags: ['Resources'],
    summary: 'List active resources',
    security: bearer,
    responses: {
      200: {
        description: 'Rooms, scanners, clinicians.',
        ...json(ResourceList),
      },
      401: problem('Unauthenticated.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/resources/{id}/availability',
    tags: ['Resources'],
    summary: 'Resource day availability',
    security: bearer,
    request: {
      params: z.object({ id: z.uuid() }),
      query: GetScheduleQuery,
    },
    responses: {
      200: {
        description: 'Working windows for the date.',
        ...json(GetResourceAvailabilityResponse),
      },
      401: problem('Unauthenticated.'),
      403: problem('Clinician may only edit own resource.'),
      404: problem('Resource not found.'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/resources/{id}/availability',
    tags: ['Resources'],
    summary: 'Set resource day availability',
    security: bearer,
    request: {
      params: z.object({ id: z.uuid() }),
      body: { ...json(SetResourceDayAvailabilityBody), required: true },
    },
    responses: {
      200: {
        description: 'Saved windows.',
        ...json(GetResourceAvailabilityResponse),
      },
      401: problem('Unauthenticated.'),
      403: problem('Clinician may only edit own resource.'),
      404: problem('Resource not found.'),
      422: problem('Invalid windows.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/service-types',
    tags: ['Catalog'],
    summary: 'List service types',
    security: bearer,
    responses: {
      200: {
        description: 'Consult, inject, scan, …',
        ...json(ServiceTypeList),
      },
      401: problem('Unauthenticated.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/appointment-templates',
    tags: ['Catalog'],
    summary: 'List appointment templates',
    security: bearer,
    responses: {
      200: {
        description: 'Preset and custom templates.',
        ...json(TemplateList),
      },
      401: problem('Unauthenticated.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/appointment-templates/{id}',
    tags: ['Catalog'],
    summary: 'Template with steps',
    security: bearer,
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Template detail.',
        ...json(AppointmentTemplateDetail),
      },
      401: problem('Unauthenticated.'),
      404: problem('Not found.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/appointment-templates',
    tags: ['Catalog'],
    summary: 'Create template (ADMIN)',
    security: bearer,
    request: {
      body: { ...json(CreateAppointmentTemplateBody), required: true },
    },
    responses: {
      201: { description: 'Created.', ...json(AppointmentTemplateDetail) },
      401: problem('Unauthenticated.'),
      403: problem('ADMIN only.'),
      422: problem('Invalid chain.'),
    },
  });

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/audit',
    tags: ['Admin'],
    summary: 'Staff activity log (ADMIN)',
    security: bearer,
    request: { query: ListAuditQuery },
    responses: {
      200: { description: 'Recent audit entries.', ...json(ListAuditResponse) },
      401: problem('Unauthenticated.'),
      403: problem('ADMIN only.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/metrics',
    tags: ['Admin'],
    summary: 'Runtime metrics (ADMIN)',
    security: bearer,
    request: {
      query: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    },
    responses: {
      200: {
        description:
          'Counters and optional day utilisation when `date` is set.',
        content: {
          'application/json': {
            schema: z
              .object({
                utilisation: z.unknown().nullable(),
              })
              .loose(),
          },
        },
      },
      401: problem('Unauthenticated.'),
      403: problem('ADMIN only.'),
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'ScanFlow API',
      version: '1.0.0',
      description: [
        'REST API for radiology clinic appointment scheduling.',
        '',
        '**Auth:** POST `/auth/login`, then send `Authorization: Bearer <accessToken>`.',
        'Refresh via POST `/auth/refresh` (httpOnly cookie).',
        '',
        '**Errors:** RFC 9457 `application/problem+json`. Slot conflicts (409) may include `freshCandidates`.',
        '',
        '**Booking:** POST `/appointments/suggestions` proposes ranked chains; POST `/appointments` books the chosen candidate after server re-validation.',
      ].join('\n'),
    },
    servers: [
      { url: '/api/v1', description: 'API v1 (relative to host root)' },
    ],
    tags: [
      { name: 'Health', description: 'Probes for orchestration' },
      { name: 'Auth', description: 'Session and identity' },
      { name: 'Schedule', description: 'Day grid and live updates' },
      { name: 'Appointments', description: 'Suggest, book, lifecycle' },
      { name: 'Patients', description: 'Patient registry' },
      { name: 'Resources', description: 'Rooms, equipment, clinician hours' },
      { name: 'Catalog', description: 'Templates and service types' },
      { name: 'Admin', description: 'Audit and metrics (ADMIN)' },
    ],
  });
}
