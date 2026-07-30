import type {
  CandidateDto,
  ChainStep,
  PlacementDto,
  SuggestAppointmentsBody,
  SuggestAppointmentsResponse,
} from '@scanflow/contracts';
import { parseAppointmentChain } from '@scanflow/contracts';
import {
  suggestPlacements,
  type Candidate,
  type EngineResource,
  type EngineStep,
  type Placement,
} from '@scanflow/scheduling-core';

import {
  NotFoundError,
  ValidationFailedError,
} from '../../errors/domain-errors.js';
import type { PatientRepository } from '../appointments/ports.js';
import type {
  ExceptionRecord,
  ResourceRecord,
  SegmentRecord,
  ServiceTypeRecord,
  WorkingHoursRecord,
} from '../shared/records.js';

import {
  buildBusyMask,
  clinicDayMinutes,
  clinicDayWindow,
  instantToSlot,
  openSlotsForResource,
  slotToInstant,
  type ClinicDayGrid,
} from './day-grid.mapper.js';
import type {
  ClinicRepository,
  ResourceRepository,
  ScheduleVersionRepository,
  SegmentRepository,
  ServiceTypeRepository,
  SuggestionMetrics,
} from './ports.js';

export interface SuggestPlacementsDeps {
  clinics: ClinicRepository;
  resources: ResourceRepository;
  serviceTypes: ServiceTypeRepository;
  segments: SegmentRepository;
  scheduleVersions: ScheduleVersionRepository;
  patients: PatientRepository;
  metrics: SuggestionMetrics;
}

export interface SuggestPlacementsCommand extends SuggestAppointmentsBody {
  clinicId: string;
}

/**
 * Loads the clinic-day, validates the chain, asks the pure engine for
 * candidates, and translates the result back into human-readable times.
 *
 * The engine never sees a timestamp or a template id. That boundary is the
 * whole point of day-grid.mapper.
 */
export function createSuggestPlacementsUseCase(deps: SuggestPlacementsDeps) {
  return async function suggestPlacementsUseCase(
    cmd: SuggestPlacementsCommand,
  ): Promise<SuggestAppointmentsResponse> {
    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) {
      throw new NotFoundError('clinic', cmd.clinicId);
    }

    const patient = await deps.patients.getById(cmd.clinicId, cmd.patientId);
    if (patient === null) {
      throw new NotFoundError('patient', cmd.patientId);
    }

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

    const engineSteps = stepsToEngine(
      chain.data,
      serviceTypes,
      clinic.grid.slotMinutes,
    );
    const day = clinicDayWindow(clinic.grid, cmd.date);
    const dayStart = day.start.toJSDate();
    const dayEnd = day.end.toJSDate();

    const resourceIds = resources.map((r) => r.id);
    const [weekly, exceptions, segments, scheduleVersion] = await Promise.all([
      deps.resources.listWorkingHours(resourceIds),
      deps.resources.listExceptions(resourceIds, cmd.date),
      deps.segments.listActiveOverlappingDay(cmd.clinicId, dayStart, dayEnd),
      deps.scheduleVersions.get(cmd.clinicId, cmd.date),
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

    let earliestSlot = 0;
    let latestEndSlot = day.totalSlots;
    if (cmd.earliestStart !== undefined) {
      earliestSlot = instantToSlot(
        clinic.grid,
        cmd.date,
        new Date(cmd.earliestStart),
      );
    }
    if (cmd.latestEnd !== undefined) {
      latestEndSlot = instantToSlot(
        clinic.grid,
        cmd.date,
        new Date(cmd.latestEnd),
      );
    }

    // Times the engine only, not the queries around it: the metric answers
    // "is the search slow", and a slow database is a different question.
    const startedAt = performance.now();
    const computed = suggestPlacements({
      totalSlots: day.totalSlots,
      steps: engineSteps,
      resources: engineResources,
      patientBusyMask,
      maxCandidates: 5,
    });
    deps.metrics.suggestionComputed(performance.now() - startedAt);

    const candidates = computed.filter(
      (candidate) =>
        candidate.startSlot >= earliestSlot &&
        candidate.endSlot <= latestEndSlot,
    );

    return {
      scheduleVersion,
      candidates: candidates.map((candidate) =>
        toCandidateDto(clinic.grid, cmd.date, candidate),
      ),
    };
  };
}

export function stepsToEngine(
  steps: readonly ChainStep[],
  serviceTypes: readonly ServiceTypeRecord[],
  slotMinutes: number,
): EngineStep[] {
  const byId = new Map(serviceTypes.map((s) => [s.id, s]));
  return steps.map((step) => {
    const service = byId.get(step.serviceTypeId);
    if (service === undefined) {
      throw new ValidationFailedError([
        {
          path: ['steps'],
          message: `Unknown service type for step ${String(step.seq)}.`,
        },
      ]);
    }
    const toSlots = (minutes: number): number => minutes / slotMinutes;
    return {
      seq: step.seq,
      resourceType: service.resourceType,
      ...(service.requiredModality === null
        ? {}
        : { requiredModality: service.requiredModality }),
      durationSlots: toSlots(step.durationMin),
      setupSlots: toSlots(step.setupMin),
      teardownSlots: toSlots(step.teardownMin),
      minGapSlots: toSlots(step.minGapMin),
      maxGapSlots: toSlots(step.maxGapMin),
      ...(step.sameResourceAsSeq === undefined
        ? {}
        : { sameResourceAsSeq: step.sameResourceAsSeq }),
    };
  });
}

export function toEngineResources(
  grid: ClinicDayGrid,
  date: string,
  resources: readonly ResourceRecord[],
  weekly: readonly WorkingHoursRecord[],
  exceptions: readonly ExceptionRecord[],
  segments: readonly SegmentRecord[],
): EngineResource[] {
  return resources.map((resource) => {
    const open = openSlotsForResource(
      grid,
      date,
      weekly.filter((w) => w.resourceId === resource.id),
      exceptions.filter((e) => e.resourceId === resource.id),
    );
    const booked = segments.flatMap((s) => {
      if (
        s.resourceId !== resource.id ||
        s.resourceStart === null ||
        s.resourceEnd === null
      ) {
        return [];
      }
      return [{ start: s.resourceStart, end: s.resourceEnd }];
    });
    return {
      id: resource.id,
      type: resource.type,
      modalities: resource.modalities,
      busyMask: buildBusyMask(grid, date, booked, open),
    };
  });
}

export function toCandidateDto(
  grid: ClinicDayGrid,
  date: string,
  candidate: Candidate,
): CandidateDto {
  return {
    start: slotToInstant(grid, date, candidate.startSlot).toISOString(),
    end: slotToInstant(grid, date, candidate.endSlot).toISOString(),
    spanMinutes: candidate.spanSlots * grid.slotMinutes,
    incidentalGapMinutes: candidate.incidentalGapSlots * grid.slotMinutes,
    placements: candidate.placements.map((p) => toPlacementDto(grid, date, p)),
  };
}

function toPlacementDto(
  grid: ClinicDayGrid,
  date: string,
  placement: Placement,
): PlacementDto {
  return {
    seq: placement.seq,
    kind: placement.kind,
    resourceId: placement.resourceId,
    patientStart: slotToInstant(
      grid,
      date,
      placement.patientStartSlot,
    ).toISOString(),
    patientEnd: slotToInstant(
      grid,
      date,
      placement.patientEndSlot,
    ).toISOString(),
    resourceStart:
      placement.resourceStartSlot === null
        ? null
        : slotToInstant(grid, date, placement.resourceStartSlot).toISOString(),
    resourceEnd:
      placement.resourceEndSlot === null
        ? null
        : slotToInstant(grid, date, placement.resourceEndSlot).toISOString(),
  };
}
