import {
  type AppointmentStatus,
  type BookAppointmentBody,
  bookAppointmentBodySchema,
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
  type ListPatientsQuery,
  listPatientsQuerySchema,
  type RescheduleAppointmentBody,
  rescheduleAppointmentBodySchema,
  type SuggestAppointmentsBody,
  suggestAppointmentsBodySchema,
} from '@scanflow/contracts';
import { Router } from 'express';

import type { AppContainer } from '../../container.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';

function routeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function buildApiRouter(container: AppContainer): Router {
  const api = Router();
  const clinicId = container.config.CLINIC_ID;

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  api.get('/ready', async (_req, res, next) => {
    try {
      await container.repos.clinics.getById(clinicId);
      res.json({ status: 'ready' });
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
        });
        res.json(body);
      } catch (error) {
        next(error);
      }
    },
  );

  api.post(
    '/appointments/suggestions',
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
    idempotency({ clinicId, records: container.repos.idempotency }),
    validate(bookAppointmentBodySchema),
    async (req, res, next) => {
      try {
        if (res.locals['idempotentReplay']) return;
        const payload = req.body as BookAppointmentBody;
        const body = await container.useCases.bookAppointment({
          clinicId,
          actorId: null,
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
          actorId: null,
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
    ['no-show', 'NO_SHOW'],
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
            actorId: null,
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
    validate(createAppointmentTemplateBodySchema),
    async (req, res, next) => {
      try {
        // ADMIN-only in M6. Until auth exists, the endpoint is open and the
        // gap is recorded in OPEN-QUESTIONS.
        const payload = req.body as CreateAppointmentTemplateBody;
        const created = await container.repos.templates.create(clinicId, {
          ...payload,
          createdBy: null,
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
