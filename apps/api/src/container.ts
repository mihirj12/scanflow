import type { ChainStep } from '@scanflow/contracts';
import pinoLogger, { type Logger } from 'pino';

import type { AppConfig } from './config.js';
import { createArgon2Hasher } from './infra/auth/argon2-hasher.js';
import { createJwtAccessTokenIssuer } from './infra/auth/jwt-access-tokens.js';
import { createRefreshTokenCodec } from './infra/auth/refresh-token-codec.js';
import { createDb, type Db } from './infra/db/client.js';
import {
  createScheduleEventBus,
  type ScheduleEventBus,
} from './infra/events/schedule-events.js';
import { createMetricsRegistry } from './infra/observability/metrics.js';
import {
  createAppointmentRepository,
  createAuditRepository,
  createIdempotencyRepository,
  createPatientRepository,
  createTemplateRepository,
  createUnitOfWork,
} from './infra/repositories/appointment.repository.js';
import { createAuditReadRepository } from './infra/repositories/audit.repository.js';
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
  createRefreshTokenRepository,
  createUserRepository,
} from './infra/repositories/user.repository.js';
import {
  createBookAppointmentUseCase,
  recomputeFreshCandidates,
} from './modules/appointments/book-appointment.usecase.js';
import {
  createChangeStatusUseCase,
  createRescheduleAppointmentUseCase,
} from './modules/appointments/change-status.usecase.js';
import { createListAuditUseCase } from './modules/audit/list-audit.usecase.js';
import { createGetCurrentUserUseCase } from './modules/auth/get-current-user.usecase.js';
import {
  createLoginUseCase,
  createLogoutUseCase,
  createRefreshSessionUseCase,
  type SessionDeps,
} from './modules/auth/session.usecase.js';
import { createGetDayUtilisationUseCase } from './modules/scheduling/day-utilisation.usecase.js';
import { createGetDayScheduleUseCase } from './modules/scheduling/get-day-schedule.usecase.js';
import { createSuggestPlacementsUseCase } from './modules/scheduling/suggest-placements.usecase.js';

/**
 * The composition root. Every repository, adapter, and use case is constructed
 * here and nowhere else — that is what makes the layering rules enforceable by
 * lint rather than by convention (ADR 0004).
 *
 * Async because argon2 hashes a decoy password at construction, so that a login
 * with an unknown email costs the same as one with a wrong password.
 */
export async function createContainer(
  config: AppConfig,
  options?: { log?: Logger; events?: ScheduleEventBus },
) {
  const log = options?.log ?? pinoLogger({ level: config.LOG_LEVEL });
  const db: Db = createDb(config.DATABASE_URL);
  const metrics = createMetricsRegistry();
  const events =
    options?.events ??
    createScheduleEventBus({ redisUrl: config.REDIS_URL, log });

  const clinics = createClinicRepository(db);
  const resources = createResourceRepository(db);
  const serviceTypes = createServiceTypeRepository(db);
  const segments = createSegmentRepository(db);
  const scheduleVersions = createScheduleVersionRepository(db);
  const patients = createPatientRepository(db);
  const templates = createTemplateRepository(db);
  const appointments = createAppointmentRepository(db);
  const audit = createAuditRepository(db);
  const auditReads = createAuditReadRepository(db);
  const idempotency = createIdempotencyRepository(db);
  const users = createUserRepository(db);
  const refreshTokens = createRefreshTokenRepository(db);
  const uow = createUnitOfWork(db);

  const hasher = await createArgon2Hasher();
  const accessTokens = createJwtAccessTokenIssuer({
    secret: config.JWT_SECRET,
    ttlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  });
  const sessionDeps: SessionDeps = {
    users,
    refreshTokens,
    hasher,
    accessTokens,
    refreshCodec: createRefreshTokenCodec(),
    clock: { now: () => new Date() },
    refreshTtlSeconds: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };

  const suggestPlacements = createSuggestPlacementsUseCase({
    clinics,
    resources,
    serviceTypes,
    segments,
    scheduleVersions,
    patients,
    metrics,
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
    events,
    metrics,
  });

  const changeStatus = createChangeStatusUseCase({
    uow,
    appointments,
    scheduleVersions,
    audit,
    events,
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
    events,
  });

  const getDaySchedule = createGetDayScheduleUseCase({
    clinics,
    resources,
    segments,
    scheduleVersions,
    appointments,
  });

  const getDayUtilisation = createGetDayUtilisationUseCase({
    clinics,
    resources,
    segments,
  });

  return {
    config,
    db,
    log,
    events,
    metrics,
    auth: { accessTokens, hasher },
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
      auditReads,
      idempotency,
      users,
      refreshTokens,
    },
    useCases: {
      suggestPlacements,
      bookAppointment,
      changeStatus,
      rescheduleAppointment,
      getDaySchedule,
      getDayUtilisation,
      listAudit: createListAuditUseCase({ audit: auditReads }),
      login: createLoginUseCase(sessionDeps),
      refreshSession: createRefreshSessionUseCase(sessionDeps),
      logout: createLogoutUseCase(sessionDeps),
      getCurrentUser: createGetCurrentUserUseCase({ users }),
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

export type AppContainer = Awaited<ReturnType<typeof createContainer>>;
