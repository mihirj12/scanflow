import {
  canEditResourceAvailability,
  type ResourceType,
  type UserRole,
} from '@scanflow/contracts';

import { ForbiddenError, NotFoundError } from '../../errors/domain-errors.js';

import { clinicDayWindow } from './day-grid.mapper.js';
import type { ClinicRepository, ResourceRepository } from './ports.js';

export interface ResourceAvailabilityDeps {
  clinics: ClinicRepository;
  resources: ResourceRepository;
}

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function assertCanEdit(
  role: UserRole,
  actorResourceId: string | null,
  resource: { id: string; type: ResourceType },
): void {
  if (
    !canEditResourceAvailability(role, actorResourceId, {
      id: resource.id,
      type: resource.type,
    })
  ) {
    throw new ForbiddenError(['ADMIN', 'RECEPTIONIST', 'CLINICIAN']);
  }
}

async function loadResource(
  deps: ResourceAvailabilityDeps,
  clinicId: string,
  resourceId: string,
) {
  const resources = await deps.resources.listActive(clinicId);
  const resource = resources.find((r) => r.id === resourceId);
  if (resource === undefined) {
    throw new NotFoundError('resource', resourceId);
  }
  return resource;
}

function formatWindows(
  windows: readonly { startsAt: string; endsAt: string }[],
): { startsAt: string; endsAt: string }[] {
  return windows
    .map((window) => ({
      startsAt: window.startsAt.slice(0, 5),
      endsAt: window.endsAt.slice(0, 5),
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Returns open intervals for one calendar date (saved rows, or weekday template). */
export function createGetResourceAvailabilityUseCase(
  deps: ResourceAvailabilityDeps,
) {
  return async function getResourceAvailability(cmd: {
    clinicId: string;
    resourceId: string;
    date: string;
    actorRole: UserRole;
    actorResourceId: string | null;
  }) {
    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', cmd.clinicId);

    const resource = await loadResource(deps, cmd.clinicId, cmd.resourceId);
    assertCanEdit(cmd.actorRole, cmd.actorResourceId, resource);

    const day = clinicDayWindow(clinic.grid, cmd.date);
    const weekday = day.start.weekday % 7;

    const [weekly, exceptions] = await Promise.all([
      deps.resources.listWorkingHours([cmd.resourceId]),
      deps.resources.listExceptions([cmd.resourceId], cmd.date),
    ]);

    const saved = exceptions.filter((row) => row.available);
    if (saved.length > 0) {
      return {
        resourceId: cmd.resourceId,
        date: cmd.date,
        savedForDate: true,
        windows: formatWindows(saved),
      };
    }

    const template = weekly
      .filter((row) => row.weekday === weekday)
      .map((row) => ({
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }));

    return {
      resourceId: cmd.resourceId,
      date: cmd.date,
      savedForDate: false,
      windows: formatWindows(template),
    };
  };
}

/** Replaces date-specific open windows for one resource on one calendar date. */
export function createSetResourceDayAvailabilityUseCase(
  deps: ResourceAvailabilityDeps,
) {
  return async function setResourceDayAvailability(cmd: {
    clinicId: string;
    resourceId: string;
    date: string;
    windows: readonly { startsAt: string; endsAt: string }[];
    actorRole: UserRole;
    actorResourceId: string | null;
  }) {
    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', cmd.clinicId);

    const resource = await loadResource(deps, cmd.clinicId, cmd.resourceId);
    assertCanEdit(cmd.actorRole, cmd.actorResourceId, resource);

    const normalized = cmd.windows.map((window) => {
      const startsAt = normalizeTime(window.startsAt);
      const endsAt = normalizeTime(window.endsAt);
      if (startsAt >= endsAt) {
        throw new NotFoundError('availability window', cmd.date);
      }
      return { startsAt, endsAt };
    });

    normalized.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let index = 1; index < normalized.length; index++) {
      const prev = normalized[index - 1];
      const current = normalized[index];
      if (
        prev !== undefined &&
        current !== undefined &&
        prev.endsAt > current.startsAt
      ) {
        throw new NotFoundError('overlapping availability windows', cmd.date);
      }
    }

    await deps.resources.replaceDayAvailabilityWindows(
      cmd.resourceId,
      cmd.date,
      normalized,
    );

    return {
      resourceId: cmd.resourceId,
      date: cmd.date,
      savedForDate: true,
      windows: formatWindows(normalized),
    };
  };
}
