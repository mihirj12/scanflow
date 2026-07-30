import type { AppointmentStatus, CandidateDto } from '@scanflow/contracts';
import { suggestPlacements } from '@scanflow/scheduling-core';

import {
  NotFoundError,
  SlotConflictError,
  StaleScheduleError,
} from '../../errors/domain-errors.js';
import {
  buildBusyMask,
  clinicDayWindow,
} from '../scheduling/day-grid.mapper.js';
import type {
  ClinicRepository,
  ResourceRepository,
  ScheduleVersionRepository,
  SegmentRepository,
  ServiceTypeRepository,
} from '../scheduling/ports.js';
import {
  stepsToEngine,
  toEngineResources,
} from '../scheduling/suggest-placements.usecase.js';

import { assertStatusTransition } from './appointment.domain.js';
import {
  candidateStillValid,
  candidateToSegments,
  isExclusionViolation,
} from './book-appointment.usecase.js';
import type {
  AppointmentRepository,
  AuditRepository,
  ScheduleEventPublisher,
  UnitOfWork,
} from './ports.js';

export interface ChangeStatusDeps {
  uow: UnitOfWork;
  appointments: AppointmentRepository;
  scheduleVersions: ScheduleVersionRepository;
  audit: AuditRepository;
  events: ScheduleEventPublisher;
}

export function createChangeStatusUseCase(deps: ChangeStatusDeps) {
  return async function changeStatus(cmd: {
    clinicId: string;
    appointmentId: string;
    to: AppointmentStatus;
    reason?: string;
    actorId: string | null;
  }) {
    const result = await deps.uow.run(async (tx) => {
      const loaded = await deps.appointments.getById(
        cmd.clinicId,
        cmd.appointmentId,
      );
      if (loaded === null) {
        throw new NotFoundError('appointment', cmd.appointmentId);
      }

      assertStatusTransition(loaded.appointment.status, cmd.to);

      const version = await deps.scheduleVersions.selectForUpdate(
        tx,
        cmd.clinicId,
        loaded.appointment.onDate,
      );

      const updated = await deps.appointments.updateStatus(tx, {
        clinicId: cmd.clinicId,
        appointmentId: cmd.appointmentId,
        status: cmd.to,
        ...(cmd.reason === undefined
          ? {}
          : {
              notes: [loaded.appointment.notes, cmd.reason]
                .filter(Boolean)
                .join('\n'),
            }),
      });

      const newVersion = await deps.scheduleVersions.bump(
        tx,
        cmd.clinicId,
        loaded.appointment.onDate,
      );

      await deps.audit.append(tx, {
        clinicId: cmd.clinicId,
        actorId: cmd.actorId,
        action: `APPOINTMENT_${cmd.to}`,
        entity: 'appointment',
        entityId: cmd.appointmentId,
        before: { status: loaded.appointment.status, scheduleVersion: version },
        after: { status: updated.status, scheduleVersion: newVersion },
      });

      return { appointment: updated, scheduleVersion: newVersion };
    });

    await deps.events.publish({
      clinicId: cmd.clinicId,
      date: result.appointment.onDate,
      version: result.scheduleVersion,
    });

    return result;
  };
}

export function createRescheduleAppointmentUseCase(deps: {
  uow: UnitOfWork;
  appointments: AppointmentRepository;
  scheduleVersions: ScheduleVersionRepository;
  clinics: ClinicRepository;
  resources: ResourceRepository;
  serviceTypes: ServiceTypeRepository;
  segments: SegmentRepository;
  audit: AuditRepository;
  events: ScheduleEventPublisher;
}) {
  return async function reschedule(cmd: {
    clinicId: string;
    appointmentId: string;
    candidate: CandidateDto;
    scheduleVersion: number;
    actorId: string | null;
  }) {
    const loaded = await deps.appointments.getById(
      cmd.clinicId,
      cmd.appointmentId,
    );
    if (loaded === null) {
      throw new NotFoundError('appointment', cmd.appointmentId);
    }
    if (
      loaded.appointment.status === 'CANCELLED' ||
      loaded.appointment.status === 'COMPLETED' ||
      loaded.appointment.status === 'NO_SHOW'
    ) {
      throw new StaleScheduleError();
    }

    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', cmd.clinicId);

    const serviceTypes = await deps.serviceTypes.listByClinic(cmd.clinicId);
    const resources = await deps.resources.listActive(cmd.clinicId);
    const day = clinicDayWindow(clinic.grid, loaded.appointment.onDate);

    try {
      const result = await deps.uow.run(async (tx) => {
        const version = await deps.scheduleVersions.selectForUpdate(
          tx,
          cmd.clinicId,
          loaded.appointment.onDate,
        );
        if (version !== cmd.scheduleVersion) {
          throw new StaleScheduleError();
        }

        // Free the old slots inside the transaction before revalidating, so
        // the appointment can move onto a slot it currently occupies.
        await deps.appointments.replaceSegments(tx, {
          appointmentId: cmd.appointmentId,
          clinicId: cmd.clinicId,
          patientId: loaded.appointment.patientId,
          segments: [],
        });

        const [weekly, exceptions, segments] = await Promise.all([
          deps.resources.listWorkingHours(resources.map((r) => r.id)),
          deps.resources.listExceptions(
            resources.map((r) => r.id),
            loaded.appointment.onDate,
          ),
          deps.segments.listActiveOverlappingDay(
            cmd.clinicId,
            day.start.toJSDate(),
            day.end.toJSDate(),
          ),
        ]);

        const fresh = suggestPlacements({
          totalSlots: day.totalSlots,
          steps: stepsToEngine(
            loaded.steps,
            serviceTypes,
            clinic.grid.slotMinutes,
          ),
          resources: toEngineResources(
            clinic.grid,
            loaded.appointment.onDate,
            resources,
            weekly,
            exceptions,
            segments,
          ),
          patientBusyMask: buildBusyMask(
            clinic.grid,
            loaded.appointment.onDate,
            segments
              .filter((s) => s.patientId === loaded.appointment.patientId)
              .map((s) => ({ start: s.patientStart, end: s.patientEnd })),
          ),
          maxCandidates: 20,
        });

        if (
          !candidateStillValid(
            clinic.grid,
            loaded.appointment.onDate,
            cmd.candidate,
            fresh,
          )
        ) {
          throw new SlotConflictError();
        }

        const newSegments = candidateToSegments(
          clinic.grid,
          loaded.appointment.onDate,
          cmd.candidate,
          loaded.steps,
          serviceTypes,
        );

        const written = await deps.appointments.replaceSegments(tx, {
          appointmentId: cmd.appointmentId,
          clinicId: cmd.clinicId,
          patientId: loaded.appointment.patientId,
          segments: newSegments,
        });

        const newVersion = await deps.scheduleVersions.bump(
          tx,
          cmd.clinicId,
          loaded.appointment.onDate,
        );

        await deps.audit.append(tx, {
          clinicId: cmd.clinicId,
          actorId: cmd.actorId,
          action: 'APPOINTMENT_RESCHEDULED',
          entity: 'appointment',
          entityId: cmd.appointmentId,
          after: { scheduleVersion: newVersion, segmentCount: written.length },
        });

        return {
          appointmentId: cmd.appointmentId,
          status: loaded.appointment.status,
          scheduleVersion: newVersion,
          segments: written.map((s) => ({
            id: s.id,
            seq: s.seq,
            kind: s.kind,
            resourceId: s.resourceId,
            patientStart: s.patientStart.toISOString(),
            patientEnd: s.patientEnd.toISOString(),
            resourceStart: s.resourceStart?.toISOString() ?? null,
            resourceEnd: s.resourceEnd?.toISOString() ?? null,
          })),
        };
      });

      await deps.events.publish({
        clinicId: cmd.clinicId,
        date: loaded.appointment.onDate,
        version: result.scheduleVersion,
      });

      return result;
    } catch (error) {
      if (isExclusionViolation(error)) throw new SlotConflictError();
      throw error;
    }
  };
}
