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
import { DateTime } from 'luxon';

import {
  NotFoundError,
  ValidationFailedError,
} from '../../errors/domain-errors.js';
import type { PatientRepository } from '../appointments/ports.js';
import type {
  ClinicRecord,
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
  maskOutsidePatientWindow,
  openSlotsForResource,
  slotToInstant,
  wallClockToInstant,
  wallClockToLatestEndSlot,
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

interface ParsedDayCommand {
  clinicId: string;
  patientId: string;
  date: string;
  steps: readonly ChainStep[];
  earliestStart?: string | undefined;
  latestEnd?: string | undefined;
  patientWindow?: { startsAt: string; endsAt: string } | undefined;
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
    const resourceIds = resources.map((r) => r.id);
    const weekly = await deps.resources.listWorkingHours(resourceIds);

    const primary = await suggestForDate(deps, clinic, cmd, {
      engineSteps,
      resources,
      weekly,
    });

    const alternateDates: NonNullable<
      SuggestAppointmentsResponse['alternateDates']
    > = [];
    if (primary.candidates.length === 0) {
      let cursor = DateTime.fromISO(cmd.date, { zone: clinic.grid.timezone });
      let scanned = 0;
      while (alternateDates.length < 5 && scanned < 30) {
        cursor = cursor.plus({ days: 1 });
        scanned += 1;
        if (cursor.weekday === 6 || cursor.weekday === 7) continue;
        const isoDate = cursor.toISODate();
        if (isoDate === null) continue;
        const dayResult = await suggestForDate(
          deps,
          clinic,
          { ...cmd, date: isoDate },
          { engineSteps, resources, weekly },
        );
        if (dayResult.candidates.length > 0) {
          alternateDates.push({
            date: isoDate,
            candidateCount: dayResult.candidates.length,
          });
        }
      }
    }

    return {
      scheduleVersion: primary.scheduleVersion,
      candidates: primary.candidates,
      ...(alternateDates.length > 0 ? { alternateDates } : {}),
    };
  };
}

function resolveSearchWindow(
  grid: ClinicDayGrid,
  cmd: ParsedDayCommand,
  totalSlots: number,
): { earliestSlot: number; latestEndSlot: number } {
  let earliestSlot = 0;
  let latestEndSlot = totalSlots;
  if (cmd.patientWindow !== undefined) {
    earliestSlot = instantToSlot(
      grid,
      cmd.date,
      wallClockToInstant(grid, cmd.date, cmd.patientWindow.startsAt),
    );
    latestEndSlot = wallClockToLatestEndSlot(
      grid,
      cmd.date,
      cmd.patientWindow.endsAt,
    );
  } else {
    if (cmd.earliestStart !== undefined) {
      earliestSlot = instantToSlot(grid, cmd.date, new Date(cmd.earliestStart));
    }
    if (cmd.latestEnd !== undefined) {
      latestEndSlot = instantToSlot(grid, cmd.date, new Date(cmd.latestEnd));
    }
  }
  return { earliestSlot, latestEndSlot };
}

async function suggestForDate(
  deps: SuggestPlacementsDeps,
  clinic: ClinicRecord,
  cmd: ParsedDayCommand,
  loaded: {
    engineSteps: EngineStep[];
    resources: readonly ResourceRecord[];
    weekly: readonly WorkingHoursRecord[];
  },
): Promise<{ scheduleVersion: number; candidates: CandidateDto[] }> {
  const day = clinicDayWindow(clinic.grid, cmd.date);
  const dayStart = day.start.toJSDate();
  const dayEnd = day.end.toJSDate();
  const resourceIds = loaded.resources.map((r) => r.id);

  const [exceptions, segments, scheduleVersion] = await Promise.all([
    deps.resources.listExceptions(resourceIds, cmd.date),
    deps.segments.listActiveOverlappingDay(cmd.clinicId, dayStart, dayEnd),
    deps.scheduleVersions.get(cmd.clinicId, cmd.date),
  ]);

  const engineResources = toEngineResources(
    clinic.grid,
    cmd.date,
    loaded.resources,
    loaded.weekly,
    exceptions,
    segments,
  );

  const searchWindow = resolveSearchWindow(clinic.grid, cmd, day.totalSlots);

  const patientBusyMask =
    buildBusyMask(
      clinic.grid,
      cmd.date,
      segments
        .filter((s) => s.patientId === cmd.patientId)
        .map((s) => ({ start: s.patientStart, end: s.patientEnd })),
    ) |
    maskOutsidePatientWindow(
      day.totalSlots,
      searchWindow.earliestSlot,
      searchWindow.latestEndSlot,
    );

  const startedAt = performance.now();
  const computed = suggestPlacements({
    totalSlots: day.totalSlots,
    steps: loaded.engineSteps,
    resources: engineResources,
    patientBusyMask,
    maxCandidates: 5,
  });
  deps.metrics.suggestionComputed(performance.now() - startedAt);

  const candidates = computed;

  return {
    scheduleVersion,
    candidates: candidates.map((candidate) =>
      toCandidateDto(clinic.grid, cmd.date, candidate),
    ),
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
