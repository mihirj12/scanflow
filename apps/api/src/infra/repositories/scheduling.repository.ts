import { and, eq, inArray, sql } from 'drizzle-orm';

import type {
  ScheduleVersionRepository,
  SegmentRepository,
  ServiceTypeRepository,
} from '../../modules/scheduling/ports.js';
import type {
  SegmentRecord,
  ServiceTypeRecord,
} from '../../modules/shared/records.js';
import type { Db, DbTransaction } from '../db/client.js';
import {
  appointment,
  appointmentSegment,
  scheduleVersion,
  serviceType,
} from '../db/schema.js';
import { parseTstzrange } from '../db/tstzrange.js';

export function createServiceTypeRepository(db: Db): ServiceTypeRepository {
  return {
    async listByClinic(clinicId) {
      const rows = await db
        .select()
        .from(serviceType)
        .where(eq(serviceType.clinicId, clinicId));
      return rows.map(toServiceTypeRecord);
    },

    async getByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(serviceType)
        .where(inArray(serviceType.id, [...ids]));
      return rows.map(toServiceTypeRecord);
    },
  };
}

export function createSegmentRepository(db: Db): SegmentRepository {
  return {
    async listActiveOverlappingDay(clinicId, dayStart, dayEnd) {
      const rows = await db
        .select({ segment: appointmentSegment })
        .from(appointmentSegment)
        .innerJoin(
          appointment,
          eq(appointment.id, appointmentSegment.appointmentId),
        )
        .where(
          and(
            eq(appointmentSegment.clinicId, clinicId),
            eq(appointmentSegment.status, 'ACTIVE'),
            inArray(appointment.status, [
              'SCHEDULED',
              'CHECKED_IN',
              'IN_PROGRESS',
            ]),
            sql`${appointmentSegment.during} && tstzrange(${dayStart.toISOString()}::timestamptz, ${dayEnd.toISOString()}::timestamptz, '[)')`,
          ),
        );
      return rows.map((row) => toSegmentRecord(row.segment));
    },
  };
}

export function createScheduleVersionRepository(
  db: Db,
): ScheduleVersionRepository {
  return {
    async get(clinicId, onDate) {
      const rows = await db
        .select()
        .from(scheduleVersion)
        .where(
          and(
            eq(scheduleVersion.clinicId, clinicId),
            eq(scheduleVersion.onDate, onDate),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row !== undefined) return row.version;

      await db
        .insert(scheduleVersion)
        .values({ clinicId, onDate, version: 1 })
        .onConflictDoNothing();

      const again = await db
        .select()
        .from(scheduleVersion)
        .where(
          and(
            eq(scheduleVersion.clinicId, clinicId),
            eq(scheduleVersion.onDate, onDate),
          ),
        )
        .limit(1);
      return again[0]?.version ?? 1;
    },

    async selectForUpdate(tx, clinicId, onDate) {
      const client = tx as DbTransaction;
      await client
        .insert(scheduleVersion)
        .values({ clinicId, onDate, version: 1 })
        .onConflictDoNothing();

      const rows = await client
        .select()
        .from(scheduleVersion)
        .where(
          and(
            eq(scheduleVersion.clinicId, clinicId),
            eq(scheduleVersion.onDate, onDate),
          ),
        )
        .for('update');
      const row = rows[0];
      if (row === undefined) {
        throw new Error('schedule_version row missing after insert');
      }
      return row.version;
    },

    async bump(tx, clinicId, onDate) {
      const client = tx as DbTransaction;
      const rows = await client
        .update(scheduleVersion)
        .set({ version: sql`${scheduleVersion.version} + 1` })
        .where(
          and(
            eq(scheduleVersion.clinicId, clinicId),
            eq(scheduleVersion.onDate, onDate),
          ),
        )
        .returning({ version: scheduleVersion.version });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('schedule_version row missing on bump');
      }
      return row.version;
    },
  };
}

function toServiceTypeRecord(
  row: typeof serviceType.$inferSelect,
): ServiceTypeRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    resourceType: row.resourceType,
    requiredModality: row.requiredModality,
  };
}

export function toSegmentRecord(
  row: typeof appointmentSegment.$inferSelect,
): SegmentRecord {
  const patient = parseTstzrange(row.during);
  const resource =
    row.resourceDuring === null ? null : parseTstzrange(row.resourceDuring);
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    clinicId: row.clinicId,
    patientId: row.patientId,
    seq: row.seq,
    kind: row.kind,
    serviceTypeId: row.serviceTypeId,
    resourceId: row.resourceId,
    patientStart: patient.start,
    patientEnd: patient.end,
    resourceStart: resource?.start ?? null,
    resourceEnd: resource?.end ?? null,
    status: row.status,
  };
}
