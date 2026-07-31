import { and, eq, inArray } from 'drizzle-orm';

import type {
  ClinicRepository,
  ResourceRepository,
} from '../../modules/scheduling/ports.js';
import type {
  ClinicRecord,
  ExceptionRecord,
  ResourceRecord,
  WorkingHoursRecord,
} from '../../modules/shared/records.js';
import type { Db } from '../db/client.js';
import {
  clinic,
  resource,
  resourceException,
  resourceWorkingHours,
} from '../db/schema.js';

export function createClinicRepository(db: Db): ClinicRepository {
  return {
    async getById(clinicId) {
      const rows = await db
        .select()
        .from(clinic)
        .where(eq(clinic.id, clinicId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return toClinicRecord(row);
    },
  };
}

export function createResourceRepository(db: Db): ResourceRepository {
  return {
    async listActive(clinicId) {
      const rows = await db
        .select()
        .from(resource)
        .where(and(eq(resource.clinicId, clinicId), eq(resource.active, true)));
      return rows.map(toResourceRecord);
    },

    async listWorkingHours(resourceIds) {
      if (resourceIds.length === 0) return [];
      const rows = await db
        .select()
        .from(resourceWorkingHours)
        .where(inArray(resourceWorkingHours.resourceId, [...resourceIds]));
      return rows.map(
        (
          row: typeof resourceWorkingHours.$inferSelect,
        ): WorkingHoursRecord => ({
          resourceId: row.resourceId,
          weekday: row.weekday,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
        }),
      );
    },

    async listExceptions(resourceIds, onDate) {
      if (resourceIds.length === 0) return [];
      const rows = await db
        .select()
        .from(resourceException)
        .where(
          and(
            inArray(resourceException.resourceId, [...resourceIds]),
            eq(resourceException.onDate, onDate),
          ),
        );
      return rows.map(
        (row: typeof resourceException.$inferSelect): ExceptionRecord => ({
          resourceId: row.resourceId,
          onDate: row.onDate,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          available: row.available,
        }),
      );
    },

    async replaceWorkingHoursForWeekday(resourceId, weekday, windows) {
      await db
        .delete(resourceWorkingHours)
        .where(
          and(
            eq(resourceWorkingHours.resourceId, resourceId),
            eq(resourceWorkingHours.weekday, weekday),
          ),
        );
      if (windows.length === 0) return;
      await db.insert(resourceWorkingHours).values(
        windows.map((window) => ({
          resourceId,
          weekday,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
        })),
      );
    },

    async replaceDayAvailabilityWindows(resourceId, onDate, windows) {
      await db
        .delete(resourceException)
        .where(
          and(
            eq(resourceException.resourceId, resourceId),
            eq(resourceException.onDate, onDate),
            eq(resourceException.available, true),
          ),
        );
      if (windows.length === 0) return;
      await db.insert(resourceException).values(
        windows.map((window) => ({
          resourceId,
          onDate,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          available: true,
        })),
      );
    },
  };
}

function toClinicRecord(row: typeof clinic.$inferSelect): ClinicRecord {
  return {
    id: row.id,
    name: row.name,
    grid: {
      timezone: row.timezone,
      dayStart: row.dayStart,
      dayEnd: row.dayEnd,
      slotMinutes: row.slotMinutes,
    },
  };
}

function toResourceRecord(row: typeof resource.$inferSelect): ResourceRecord {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    modalities: row.modalities,
    displayOrder: row.displayOrder,
    active: row.active,
  };
}
