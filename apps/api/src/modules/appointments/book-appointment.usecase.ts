import type {
  BookAppointmentBody,
  BookAppointmentResponse,
  CandidateDto,
  ChainStep,
} from '@scanflow/contracts';
import { parseAppointmentChain } from '@scanflow/contracts';
import { suggestPlacements, type Candidate } from '@scanflow/scheduling-core';

import {
  NotFoundError,
  SlotConflictError,
  StaleScheduleError,
  ValidationFailedError,
} from '../../errors/domain-errors.js';
import {
  buildBusyMask,
  clinicDayMinutes,
  clinicDayWindow,
  instantToSlot,
  type ClinicDayGrid,
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
  toCandidateDto,
  toEngineResources,
} from '../scheduling/suggest-placements.usecase.js';
import type { NewSegment, ServiceTypeRecord } from '../shared/records.js';

import type {
  AppointmentRepository,
  AuditRepository,
  BookingMetrics,
  PatientRepository,
  ScheduleEventPublisher,
  TemplateRepository,
  UnitOfWork,
} from './ports.js';

export interface BookAppointmentDeps {
  uow: UnitOfWork;
  clinics: ClinicRepository;
  resources: ResourceRepository;
  serviceTypes: ServiceTypeRepository;
  segments: SegmentRepository;
  scheduleVersions: ScheduleVersionRepository;
  patients: PatientRepository;
  appointments: AppointmentRepository;
  templates: TemplateRepository;
  audit: AuditRepository;
  events: ScheduleEventPublisher;
  metrics: BookingMetrics;
}

export interface BookAppointmentCommand extends BookAppointmentBody {
  clinicId: string;
  actorId: string | null;
}

/**
 * Books a chosen candidate inside one transaction.
 *
 * Order is deliberate (spec 5.4): lock the clinic-day version, reject a stale
 * client view, re-validate the candidate against current occupancy, insert,
 * bump the version, write the audit row. The exclusion constraints are the
 * final arbiter — SQLSTATE 23P01 becomes a SlotConflictError.
 */
export function createBookAppointmentUseCase(deps: BookAppointmentDeps) {
  return async function bookAppointment(
    cmd: BookAppointmentCommand,
  ): Promise<BookAppointmentResponse> {
    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', cmd.clinicId);

    const patient = await deps.patients.getById(cmd.clinicId, cmd.patientId);
    if (patient === null) throw new NotFoundError('patient', cmd.patientId);

    const serviceTypes = await deps.serviceTypes.listByClinic(cmd.clinicId);
    const resources = await deps.resources.listActive(cmd.clinicId);

    const chain = parseAppointmentChain(cmd.steps, {
      slotMinutes: clinic.grid.slotMinutes,
      dayMinutes: clinicDayMinutes(clinic.grid, cmd.date),
      serviceTypes: serviceTypes.map((s) => ({
        id: s.id,
        resourceType: s.resourceType,
        requiredModality: s.requiredModality,
      })),
      resources: resources.map((r) => ({
        type: r.type,
        modalities: r.modalities,
        active: r.active,
      })),
    });
    if (!chain.success) {
      throw new ValidationFailedError(
        chain.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      );
    }

    let templateName: string | null = null;
    if (cmd.templateId !== undefined) {
      const loaded = await deps.templates.getWithSteps(
        cmd.clinicId,
        cmd.templateId,
      );
      if (loaded === null) throw new NotFoundError('template', cmd.templateId);
      templateName = loaded.template.name;
    }

    const day = clinicDayWindow(clinic.grid, cmd.date);
    const resourceIds = resources.map((r) => r.id);

    deps.metrics.bookingAttempted();

    try {
      const result = await deps.uow.run(async (tx) => {
        const version = await deps.scheduleVersions.selectForUpdate(
          tx,
          cmd.clinicId,
          cmd.date,
        );
        if (version !== cmd.scheduleVersion) {
          throw new StaleScheduleError();
        }

        const [weekly, exceptions, segments] = await Promise.all([
          deps.resources.listWorkingHours(resourceIds),
          deps.resources.listExceptions(resourceIds, cmd.date),
          deps.segments.listActiveOverlappingDay(
            cmd.clinicId,
            day.start.toJSDate(),
            day.end.toJSDate(),
          ),
        ]);

        const engineResources = toEngineResources(
          clinic.grid,
          cmd.date,
          resources,
          weekly,
          exceptions,
          segments,
        );
        const patientBusyMask = buildBusyMask(
          clinic.grid,
          cmd.date,
          segments
            .filter((s) => s.patientId === cmd.patientId)
            .map((s) => ({ start: s.patientStart, end: s.patientEnd })),
        );
        const engineSteps = stepsToEngine(
          chain.data,
          serviceTypes,
          clinic.grid.slotMinutes,
        );

        // Re-validate: the chosen candidate must still be among today's
        // suggestions. Trusting the client's arithmetic would let a stale UI
        // double-book.
        const fresh = suggestPlacements({
          totalSlots: day.totalSlots,
          steps: engineSteps,
          resources: engineResources,
          patientBusyMask,
          maxCandidates: 20,
        });
        if (!candidateStillValid(clinic.grid, cmd.date, cmd.candidate, fresh)) {
          throw new SlotConflictError();
        }

        const newSegments = candidateToSegments(
          clinic.grid,
          cmd.date,
          cmd.candidate,
          chain.data,
          serviceTypes,
        );

        const booked = await deps.appointments.insertBooking(tx, {
          clinicId: cmd.clinicId,
          patientId: cmd.patientId,
          templateId: cmd.templateId ?? null,
          templateNameAtBooking: templateName,
          onDate: cmd.date,
          notes: cmd.notes ?? null,
          createdBy: cmd.actorId,
          steps: chain.data,
          segments: newSegments,
        });

        const newVersion = await deps.scheduleVersions.bump(
          tx,
          cmd.clinicId,
          cmd.date,
        );

        await deps.audit.append(tx, {
          clinicId: cmd.clinicId,
          actorId: cmd.actorId,
          action: 'APPOINTMENT_BOOKED',
          entity: 'appointment',
          entityId: booked.appointment.id,
          after: {
            appointmentId: booked.appointment.id,
            onDate: cmd.date,
            segmentCount: booked.segments.length,
          },
        });

        return {
          appointmentId: booked.appointment.id,
          status: booked.appointment.status,
          scheduleVersion: newVersion,
          segments: booked.segments.map((s) => ({
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
        date: cmd.date,
        version: result.scheduleVersion,
      });

      return result;
    } catch (error) {
      if (isExclusionViolation(error)) {
        deps.metrics.bookingConflicted();
        throw new SlotConflictError();
      }
      if (
        error instanceof StaleScheduleError ||
        error instanceof SlotConflictError
      ) {
        deps.metrics.bookingConflicted();
      }
      throw error;
    }
  };
}

/** True when the client's candidate still appears among freshly computed ones. */
export function candidateStillValid(
  grid: ClinicDayGrid,
  date: string,
  chosen: CandidateDto,
  fresh: readonly Candidate[],
): boolean {
  const chosenKey = candidateKeyFromDto(grid, date, chosen);
  return fresh.some(
    (candidate) => candidateKeyFromEngine(candidate) === chosenKey,
  );
}

function candidateKeyFromDto(
  grid: ClinicDayGrid,
  date: string,
  candidate: CandidateDto,
): string {
  const startSlot = instantToSlot(grid, date, new Date(candidate.start));
  const ids = candidate.placements
    .filter((p) => p.kind === 'SERVICE')
    .map((p) => p.resourceId ?? '')
    .join('>');
  return `${String(startSlot)}#${ids}`;
}

function candidateKeyFromEngine(candidate: Candidate): string {
  const ids = candidate.placements
    .filter((p) => p.kind === 'SERVICE')
    .map((p) => p.resourceId ?? '')
    .join('>');
  return `${String(candidate.startSlot)}#${ids}`;
}

export function candidateToSegments(
  _grid: ClinicDayGrid,
  _date: string,
  candidate: CandidateDto,
  steps: readonly ChainStep[],
  _serviceTypes: readonly ServiceTypeRecord[],
): NewSegment[] {
  const stepBySeq = new Map(steps.map((s) => [s.seq, s]));

  return candidate.placements.map((placement) => {
    const step = stepBySeq.get(placement.seq);
    const serviceTypeId =
      placement.kind === 'SERVICE' && step !== undefined
        ? step.serviceTypeId
        : null;

    return {
      seq: placement.seq,
      kind: placement.kind,
      serviceTypeId,
      resourceId: placement.resourceId,
      patientStart: new Date(placement.patientStart),
      patientEnd: new Date(placement.patientEnd),
      resourceStart:
        placement.resourceStart === null
          ? null
          : new Date(placement.resourceStart),
      resourceEnd:
        placement.resourceEnd === null ? null : new Date(placement.resourceEnd),
    };
  });
}

export function isExclusionViolation(error: unknown): boolean {
  // postgres.js puts SQLSTATE on the error; Drizzle may wrap it under `.cause`
  // (and sometimes deeper). Walk a few layers rather than assume one shape.
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === '23P01') return true;
    current = record.cause;
  }
  return false;
}

/** Recompute suggestions for a 409 body. Shared by book and the error handler. */
export async function recomputeFreshCandidates(
  deps: Pick<
    BookAppointmentDeps,
    'clinics' | 'resources' | 'serviceTypes' | 'segments' | 'patients'
  >,
  args: {
    clinicId: string;
    patientId: string;
    date: string;
    steps: readonly ChainStep[];
  },
): Promise<CandidateDto[]> {
  const clinic = await deps.clinics.getById(args.clinicId);
  if (clinic === null) return [];
  const serviceTypes = await deps.serviceTypes.listByClinic(args.clinicId);
  const resources = await deps.resources.listActive(args.clinicId);
  const day = clinicDayWindow(clinic.grid, args.date);
  const [weekly, exceptions, segments] = await Promise.all([
    deps.resources.listWorkingHours(resources.map((r) => r.id)),
    deps.resources.listExceptions(
      resources.map((r) => r.id),
      args.date,
    ),
    deps.segments.listActiveOverlappingDay(
      args.clinicId,
      day.start.toJSDate(),
      day.end.toJSDate(),
    ),
  ]);
  const fresh = suggestPlacements({
    totalSlots: day.totalSlots,
    steps: stepsToEngine(args.steps, serviceTypes, clinic.grid.slotMinutes),
    resources: toEngineResources(
      clinic.grid,
      args.date,
      resources,
      weekly,
      exceptions,
      segments,
    ),
    patientBusyMask: buildBusyMask(
      clinic.grid,
      args.date,
      segments
        .filter((s) => s.patientId === args.patientId)
        .map((s) => ({ start: s.patientStart, end: s.patientEnd })),
    ),
    maxCandidates: 5,
  });
  return fresh.map((c) => toCandidateDto(clinic.grid, args.date, c));
}
