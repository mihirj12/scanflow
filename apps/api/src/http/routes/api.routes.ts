import {
  type AppointmentStatus,
  type BookAppointmentBody,
  bookAppointmentBodySchema,
  canBookAppointments,
  type CancelAppointmentBody,
  cancelAppointmentBodySchema,
  type CreateAppointmentTemplateBody,
  createAppointmentTemplateBodySchema,
  type CreatePatientBody,
  createPatientBodySchema,
  type GetScheduleQuery,
  getScheduleQuerySchema,
  type ListAppointmentsQuery,
  listAppointmentsQuerySchema,
  type ListAuditQuery,
  listAuditQuerySchema,
  type ListPatientsQuery,
  listPatientsQuerySchema,
  type RescheduleAppointmentBody,
  rescheduleAppointmentBodySchema,
  type SetResourceDayAvailabilityBody,
  setResourceDayAvailabilityBodySchema,
  type SuggestAppointmentsBody,
  suggestAppointmentsBodySchema,
} from '@scanflow/contracts';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import type { AppContainer } from '../../container.js';
import { ForbiddenError } from '../../errors/domain-errors.js';
import { streamSchedule } from '../controllers/schedule-stream.controller.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';

import { buildAuthRouter } from './auth.routes.js';

function routeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * The actor for the audit trail. Null is unreachable below the guard, but the
 * type stays nullable because `audit_log` also records system-initiated rows.
 */
function actorOf(req: { auth?: { userId: string } }): string | null {
  return req.auth?.userId ?? null;
}

/** Clinicians view the schedule; only reception and admin book. */
function requireBookPermission(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const role = req.auth?.role;
  if (role === undefined || !canBookAppointments(role)) {
    next(new ForbiddenError(['RECEPTIONIST', 'ADMIN']));
    return;
  }
  next();
}

export function buildApiRouter(container: AppContainer): Router {
  const api = Router();
  const clinicId = container.config.CLINIC_ID;

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /**
   * Readiness, unlike liveness, touches the database. A failure is a 503 rather
   * than a 500: the process is fine, it is the dependency that is not, and that
   * is the distinction a load balancer acts on.
   */
  api.get('/ready', async (_req, res) => {
    try {
      const clinic = await container.repos.clinics.getById(clinicId);
      if (clinic === null) throw new Error('configured clinic is missing');
      res.json({ status: 'ready' });
    } catch (error) {
      container.log.warn({ err: error }, 'readiness check failed');
      res.status(503).type('application/problem+json').json({
        type: 'https://scanflow.local/problems/not-ready',
        title: 'Not ready',
        status: 503,
        detail: 'The database is not reachable. Retry shortly.',
      });
    }
  });

  // Public: signing in is how you stop being unauthenticated.
  api.use('/auth', buildAuthRouter(container));

  /**
   * Everything below this line requires an access token. Mounting the guard on
   * the router — rather than listing it per route — means a new endpoint is
   * protected by default, and forgetting it is not a possible mistake.
   */
  api.use(
    authenticate({ accessTokens: container.auth.accessTokens, clinicId }),
  );

  api.get(
    '/schedule/stream',
    streamSchedule({ events: container.events, clinicId }),
  );

  api.get(
    '/audit',
    requireRole('ADMIN'),
    validate(listAuditQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const query = req.query as unknown as ListAuditQuery;
        res.json(
          await container.useCases.listAudit({
            clinicId,
            limit: query.limit,
            ...(query.entityId === undefined
              ? {}
              : { entityId: query.entityId }),
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  api.get('/metrics', requireRole('ADMIN'), async (req, res, next) => {
    try {
      const date = req.query['date'];
      const utilisation =
        typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? await container.useCases.getDayUtilisation({ clinicId, date })
          : null;
      res.json({ ...container.metrics.snapshot(), utilisation });
    } catch (error) {
      next(error);
    }
  });

  api.get(
    '/schedule',
    validate(getScheduleQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const query = req.query as unknown as GetScheduleQuery;
        const body = await container.useCases.getDaySchedule({
          clinicId,
          date: query.date,
          actorRole: req.auth?.role ?? 'RECEPTIONIST',
          actorResourceId: req.auth?.resourceId ?? null,
        });
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  api.post(
    '/appointments/suggestions',
    requireBookPermission,
    validate(suggestAppointmentsBodySchema),
    async (req, res, next) => {
      try {
        const payload = req.body as SuggestAppointmentsBody;
        const body = await container.useCases.suggestPlacements({
          clinicId,
          ...payload,
        });
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  api.post(
    '/appointments',
    requireBookPermission,
    idempotency({ clinicId, records: container.repos.idempotency }),
    validate(bookAppointmentBodySchema),
    async (req, res, next) => {
      try {
        if (res.locals['idempotentReplay']) return;
        const payload = req.body as BookAppointmentBody;
        const body = await container.useCases.bookAppointment({
          clinicId,
          actorId: actorOf(req),
          ...payload,
        });
        const save = res.locals['saveIdempotency'] as
          ((status: number, body: unknown) => Promise<void>) | undefined;
        if (save !== undefined) {
          await save(201, body);
        }
        res.status(201).json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  api.get(
    '/appointments',
    validate(listAppointmentsQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const query = req.query as unknown as ListAppointmentsQuery;
        const result = await container.repos.appointments.list({
          clinicId,
          limit: query.limit,
          ...(query.date === undefined ? {} : { date: query.date }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.patientId === undefined
            ? {}
            : { patientId: query.patientId }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        });
        res.json({
          items: result.items.map((item) => ({
            id: item.appointment.id,
            patientId: item.appointment.patientId,
            onDate: item.appointment.onDate,
            status: item.appointment.status,
            templateId: item.appointment.templateId,
            templateNameAtBooking: item.appointment.templateNameAtBooking,
            notes: item.appointment.notes,
            steps: item.steps,
            segments: item.segments.map((s) => ({
              id: s.id,
              seq: s.seq,
              kind: s.kind,
              resourceId: s.resourceId,
              patientStart: s.patientStart.toISOString(),
              patientEnd: s.patientEnd.toISOString(),
              resourceStart: s.resourceStart?.toISOString() ?? null,
              resourceEnd: s.resourceEnd?.toISOString() ?? null,
            })),
            scheduleVersion: 0,
            createdAt: item.appointment.createdAt.toISOString(),
            updatedAt: item.appointment.updatedAt.toISOString(),
          })),
          nextCursor: result.nextCursor,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  api.get('/appointments/:id', async (req, res, next) => {
    try {
      const id = routeParam(req.params.id);
      if (id === undefined) {
        res.status(400).end();
        return;
      }
      const loaded = await container.repos.appointments.getById(clinicId, id);
      if (loaded === null) {
        res
          .status(404)
          .type('application/problem+json')
          .json({
            type: 'https://scanflow.local/problems/not-found',
            title: 'Not found',
            status: 404,
            detail: `appointment '${id}' was not found. Check the id and try again.`,
          });
        return;
      }
      const scheduleVersion = await container.repos.scheduleVersions.get(
        clinicId,
        loaded.appointment.onDate,
      );
      res.json({
        id: loaded.appointment.id,
        patientId: loaded.appointment.patientId,
        onDate: loaded.appointment.onDate,
        status: loaded.appointment.status,
        templateId: loaded.appointment.templateId,
        templateNameAtBooking: loaded.appointment.templateNameAtBooking,
        notes: loaded.appointment.notes,
        steps: loaded.steps,
        segments: loaded.segments.map((s) => ({
          id: s.id,
          seq: s.seq,
          kind: s.kind,
          resourceId: s.resourceId,
          patientStart: s.patientStart.toISOString(),
          patientEnd: s.patientEnd.toISOString(),
          resourceStart: s.resourceStart?.toISOString() ?? null,
          resourceEnd: s.resourceEnd?.toISOString() ?? null,
        })),
        scheduleVersion,
        createdAt: loaded.appointment.createdAt.toISOString(),
        updatedAt: loaded.appointment.updatedAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  api.post(
    '/appointments/:id/reschedule',
    idempotency({ clinicId, records: container.repos.idempotency }),
    validate(rescheduleAppointmentBodySchema),
    async (req, res, next) => {
      try {
        if (res.locals['idempotentReplay']) return;
        const id = routeParam(req.params['id']);
        if (id === undefined) {
          res.status(400).end();
          return;
        }
        const payload = req.body as RescheduleAppointmentBody;
        const body = await container.useCases.rescheduleAppointment({
          clinicId,
          appointmentId: id,
          actorId: actorOf(req),
          ...payload,
        });
        const save = res.locals['saveIdempotency'] as
          ((status: number, body: unknown) => Promise<void>) | undefined;
        if (save !== undefined) {
          await save(200, body);
        }
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  for (const [path, to] of [
    ['cancel', 'CANCELLED'],
    ['check-in', 'CHECKED_IN'],
    ['undo-check-in', 'SCHEDULED'],
    ['no-show', 'NO_SHOW'],
    ['start', 'IN_PROGRESS'],
    ['complete', 'COMPLETED'],
  ] as const satisfies readonly (readonly [string, AppointmentStatus])[]) {
    api.post(
      `/appointments/:id/${path}`,
      path === 'cancel'
        ? validate(cancelAppointmentBodySchema)
        : (_req, _res, next) => {
            next();
          },
      async (req, res, next) => {
        try {
          const id = routeParam(req.params.id);
          if (id === undefined) {
            res.status(400).end();
            return;
          }
          const cancelBody = req.body as CancelAppointmentBody;
          const result = await container.useCases.changeStatus({
            clinicId,
            appointmentId: id,
            to,
            actorId: actorOf(req),
            ...(cancelBody.reason === undefined
              ? {}
              : { reason: cancelBody.reason }),
          });
          res.json({
            appointmentId: result.appointment.id,
            status: result.appointment.status,
            scheduleVersion: result.scheduleVersion,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  api.get('/patients/:id', async (req, res, next) => {
    try {
      const id = routeParam(req.params.id);
      if (id === undefined) {
        res.status(400).end();
        return;
      }
      const found = await container.repos.patients.getById(clinicId, id);
      if (found === null) {
        res
          .status(404)
          .type('application/problem+json')
          .json({
            type: 'https://scanflow.local/problems/not-found',
            title: 'Not found',
            status: 404,
            detail: `patient '${id}' was not found. Check the id and try again.`,
          });
        return;
      }
      res.json({
        id: found.id,
        mrn: found.mrn,
        fullName: found.fullName,
        dateOfBirth: found.dateOfBirth,
        phone: found.phone,
        createdAt: found.createdAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  api.get(
    '/patients',
    validate(listPatientsQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const query = req.query as unknown as ListPatientsQuery;
        const items = await container.repos.patients.search(
          clinicId,
          query.q,
          query.limit,
        );
        res.json({
          items: items.map((p) => ({
            id: p.id,
            mrn: p.mrn,
            fullName: p.fullName,
            dateOfBirth: p.dateOfBirth,
            phone: p.phone,
            createdAt: p.createdAt.toISOString(),
          })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  api.post(
    '/patients',
    validate(createPatientBodySchema),
    async (req, res, next) => {
      try {
        const payload = req.body as CreatePatientBody;
        const created = await container.repos.patients.create(clinicId, {
          mrn: payload.mrn,
          fullName: payload.fullName,
          ...(payload.dateOfBirth === undefined
            ? {}
            : { dateOfBirth: payload.dateOfBirth }),
          ...(payload.phone === undefined ? {} : { phone: payload.phone }),
        });
        res.status(201).json({
          id: created.id,
          mrn: created.mrn,
          fullName: created.fullName,
          dateOfBirth: created.dateOfBirth,
          phone: created.phone,
          createdAt: created.createdAt.toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  api.get('/resources', async (_req, res, next) => {
    try {
      const items = await container.repos.resources.listActive(clinicId);
      res.json({
        items: items.map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          modalities: [...r.modalities],
          displayOrder: r.displayOrder,
          active: r.active,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  api.get(
    '/resources/:id/availability',
    validate(getScheduleQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const resourceId = routeParam(req.params['id']);
        if (resourceId === undefined) {
          res.status(400).end();
          return;
        }
        const query = req.query as unknown as GetScheduleQuery;
        const body = await container.useCases.getResourceAvailability({
          clinicId,
          resourceId,
          date: query.date,
          actorRole: req.auth?.role ?? 'RECEPTIONIST',
          actorResourceId: req.auth?.resourceId ?? null,
        });
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  api.put(
    '/resources/:id/availability',
    validate(setResourceDayAvailabilityBodySchema),
    async (req, res, next) => {
      try {
        const resourceId = routeParam(req.params['id']);
        if (resourceId === undefined) {
          res.status(400).end();
          return;
        }
        const payload = req.body as SetResourceDayAvailabilityBody;
        const body = await container.useCases.setResourceDayAvailability({
          clinicId,
          resourceId,
          date: payload.date,
          windows: payload.windows,
          actorRole: req.auth?.role ?? 'RECEPTIONIST',
          actorResourceId: req.auth?.resourceId ?? null,
        });
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  api.get('/service-types', async (_req, res, next) => {
    try {
      const items = await container.repos.serviceTypes.listByClinic(clinicId);
      res.json({
        items: items.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          resourceType: s.resourceType,
          requiredModality: s.requiredModality,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  api.get('/appointment-templates', async (_req, res, next) => {
    try {
      const items = await container.repos.templates.list(clinicId);
      res.json({
        items: items.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          isPreset: t.isPreset,
          active: t.active,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  api.get('/appointment-templates/:id', async (req, res, next) => {
    try {
      const id = routeParam(req.params.id);
      if (id === undefined) {
        res.status(400).end();
        return;
      }
      const loaded = await container.repos.templates.getWithSteps(clinicId, id);
      if (loaded === null) {
        res
          .status(404)
          .type('application/problem+json')
          .json({
            type: 'https://scanflow.local/problems/not-found',
            title: 'Not found',
            status: 404,
            detail: `template '${id}' was not found. Check the id and try again.`,
          });
        return;
      }
      res.json({
        id: loaded.template.id,
        code: loaded.template.code,
        name: loaded.template.name,
        isPreset: loaded.template.isPreset,
        active: loaded.template.active,
        steps: loaded.steps,
      });
    } catch (error) {
      next(error);
    }
  });

  api.post(
    '/appointment-templates',
    requireRole('ADMIN'),
    validate(createAppointmentTemplateBodySchema),
    async (req, res, next) => {
      try {
        const payload = req.body as CreateAppointmentTemplateBody;
        const created = await container.repos.templates.create(clinicId, {
          ...payload,
          createdBy: actorOf(req),
        });
        res.status(201).json({
          id: created.template.id,
          code: created.template.code,
          name: created.template.name,
          isPreset: created.template.isPreset,
          active: created.template.active,
          steps: created.steps,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return api;
}
