import { NotFoundError } from '../../errors/domain-errors.js';

import {
  clinicDayWindow,
  openSlotsForResource,
  type ClinicDayGrid,
} from './day-grid.mapper.js';
import type {
  ClinicRepository,
  ResourceRepository,
  SegmentRepository,
} from './ports.js';

export interface ResourceUtilisation {
  resourceId: string;
  name: string;
  openMinutes: number;
  bookedMinutes: number;
  /** Booked over open, 0–1. Open minutes come from working hours, not the clinic day. */
  utilisation: number;
}

export interface DayUtilisation {
  date: string;
  resources: ResourceUtilisation[];
  openMinutes: number;
  bookedMinutes: number;
  utilisation: number;
}

/**
 * Resource utilisation for one clinic-day: the third domain metric (spec 9).
 *
 * Measured against each resource's *own* working hours rather than the clinic
 * day, because a scanner staffed for four hours and busy for four hours is fully
 * utilised, and reporting it as 50% would send someone shopping for a scanner.
 */
export function createGetDayUtilisationUseCase(deps: {
  clinics: ClinicRepository;
  resources: ResourceRepository;
  segments: SegmentRepository;
}) {
  return async function getDayUtilisation(query: {
    clinicId: string;
    date: string;
  }): Promise<DayUtilisation> {
    const clinic = await deps.clinics.getById(query.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', query.clinicId);

    const resources = await deps.resources.listActive(query.clinicId);
    const resourceIds = resources.map((r) => r.id);
    const day = clinicDayWindow(clinic.grid, query.date);

    const [weekly, exceptions, segments] = await Promise.all([
      deps.resources.listWorkingHours(resourceIds),
      deps.resources.listExceptions(resourceIds, query.date),
      deps.segments.listActiveOverlappingDay(
        query.clinicId,
        day.start.toJSDate(),
        day.end.toJSDate(),
      ),
    ]);

    const perResource = resources.map((resource): ResourceUtilisation => {
      const open = openSlotsForResource(
        clinic.grid,
        query.date,
        weekly.filter((w) => w.resourceId === resource.id),
        exceptions.filter((e) => e.resourceId === resource.id),
      );
      const bookedMinutes = segments.reduce((total, segment) => {
        if (
          segment.resourceId !== resource.id ||
          segment.resourceStart === null ||
          segment.resourceEnd === null
        ) {
          return total;
        }
        return total + clippedMinutes(clinic.grid, query.date, segment);
      }, 0);
      const openMinutes = open.size * clinic.grid.slotMinutes;
      return {
        resourceId: resource.id,
        name: resource.name,
        openMinutes,
        bookedMinutes,
        utilisation: ratio(bookedMinutes, openMinutes),
      };
    });

    const openMinutes = perResource.reduce((n, r) => n + r.openMinutes, 0);
    const bookedMinutes = perResource.reduce((n, r) => n + r.bookedMinutes, 0);

    return {
      date: query.date,
      resources: perResource,
      openMinutes,
      bookedMinutes,
      utilisation: ratio(bookedMinutes, openMinutes),
    };
  };
}

function clippedMinutes(
  grid: ClinicDayGrid,
  date: string,
  segment: { resourceStart: Date | null; resourceEnd: Date | null },
): number {
  if (segment.resourceStart === null || segment.resourceEnd === null) return 0;
  const day = clinicDayWindow(grid, date);
  const dayStart = day.start.toMillis();
  const dayEnd = day.end.toMillis();
  const from = Math.max(segment.resourceStart.getTime(), dayStart);
  const to = Math.min(segment.resourceEnd.getTime(), dayEnd);
  return to <= from ? 0 : (to - from) / 60_000;
}

function ratio(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 10_000) / 10_000;
}
