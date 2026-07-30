import type { ChainStep } from '@scanflow/contracts';

import type { AppConfig } from './config.js';
import { createDb, type Db } from './infra/db/client.js';
import {
  createAppointmentRepository,
  createAuditRepository,
  createIdempotencyRepository,
  createPatientRepository,
  createTemplateRepository,
  createUnitOfWork,
} from './infra/repositories/appointment.repository.js';
import {
  createClinicRepository,
  createResourceRepository,
} from './infra/repositories/clinic-resource.repository.js';
import {
  createScheduleVersionRepository,
  createSegmentRepository,
  createServiceTypeRepository,
} from './infra/repositories/scheduling.repository.js';
import {
  createBookAppointmentUseCase,
  recomputeFreshCandidates,
} from './modules/appointments/book-appointment.usecase.js';
import {
  createChangeStatusUseCase,
  createRescheduleAppointmentUseCase,
} from './modules/appointments/change-status.usecase.js';
import { createGetDayScheduleUseCase } from './modules/scheduling/get-day-schedule.usecase.js';
import { createSuggestPlacementsUseCase } from './modules/scheduling/suggest-placements.usecase.js';

/**
 * The composition root. Every repository and use case is constructed here and
 * nowhere else — that is what makes the layering rules enforceable by lint
 * rather than by convention (ADR 0004).
 */
export function createContainer(config: AppConfig) {
  const db: Db = createDb(config.DATABASE_URL);

  const clinics = createClinicRepository(db);
  const resources = createResourceRepository(db);
  const serviceTypes = createServiceTypeRepository(db);
  const segments = createSegmentRepository(db);
  const scheduleVersions = createScheduleVersionRepository(db);
  const patients = createPatientRepository(db);
  const templates = createTemplateRepository(db);
  const appointments = createAppointmentRepository(db);
  const audit = createAuditRepository(db);
  const idempotency = createIdempotencyRepository(db);
  const uow = createUnitOfWork(db);

  const suggestPlacements = createSuggestPlacementsUseCase({
    clinics,
    resources,
    serviceTypes,
    segments,
    scheduleVersions,
    patients,
  });

  const bookAppointment = createBookAppointmentUseCase({
    uow,
    clinics,
    resources,
    serviceTypes,
    segments,
    scheduleVersions,
    patients,
    appointments,
    templates,
    audit,
  });

  const changeStatus = createChangeStatusUseCase({
    uow,
    appointments,
    scheduleVersions,
    audit,
  });

  const rescheduleAppointment = createRescheduleAppointmentUseCase({
    uow,
    appointments,
    scheduleVersions,
    clinics,
    resources,
    serviceTypes,
    segments,
    audit,
  });

  const getDaySchedule = createGetDayScheduleUseCase({
    clinics,
    resources,
    segments,
    scheduleVersions,
    appointments,
  });

  return {
    config,
    db,
    repos: {
      clinics,
      resources,
      serviceTypes,
      segments,
      scheduleVersions,
      patients,
      templates,
      appointments,
      audit,
      idempotency,
    },
    useCases: {
      suggestPlacements,
      bookAppointment,
      changeStatus,
      rescheduleAppointment,
      getDaySchedule,
      loadFreshCandidates: (args: {
        clinicId: string;
        patientId: string;
        date: string;
        steps: readonly ChainStep[];
      }) =>
        recomputeFreshCandidates(
          { clinics, resources, serviceTypes, segments, patients },
          args,
        ),
    },
  };
}

export type AppContainer = ReturnType<typeof createContainer>;
