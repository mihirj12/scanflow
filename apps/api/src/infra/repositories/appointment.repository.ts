import type { ChainStep } from '@scanflow/contracts';
import { and, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';

import type {
  AppointmentRepository,
  AuditRepository,
  IdempotencyRepository,
  PatientRepository,
  TemplateRepository,
  UnitOfWork,
} from '../../modules/appointments/ports.js';
import type {
  AppointmentRecord,
  PatientRecord,
  SegmentRecord,
  TemplateRecord,
} from '../../modules/shared/records.js';
import type { Db, DbTransaction } from '../db/client.js';
import {
  appointment,
  appointmentSegment,
  appointmentStep,
  appointmentTemplate,
  auditLog,
  idempotencyRecord,
  patient,
  templateStep,
} from '../db/schema.js';
import { formatTstzrange } from '../db/tstzrange.js';

import { toSegmentRecord } from './scheduling.repository.js';

export function createUnitOfWork(db: Db): UnitOfWork {
  return {
    run(work) {
      return db.transaction(async (tx: DbTransaction) => work(tx));
    },
  };
}

export function createPatientRepository(db: Db): PatientRepository {
  return {
    async getById(clinicId, patientId) {
      const rows = await db
        .select()
        .from(patient)
        .where(and(eq(patient.clinicId, clinicId), eq(patient.id, patientId)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toPatientRecord(row);
    },

    async getByIds(clinicId, patientIds) {
      if (patientIds.length === 0) return new Map();
      const rows = await db
        .select()
        .from(patient)
        .where(
          and(
            eq(patient.clinicId, clinicId),
            inArray(patient.id, [...patientIds]),
          ),
        );
      const map = new Map<string, PatientRecord>();
      for (const row of rows) {
        map.set(row.id, toPatientRecord(row));
      }
      return map;
    },

    async search(clinicId, q, limit) {
      const filters =
        q === undefined || q.trim() === ''
          ? eq(patient.clinicId, clinicId)
          : and(
              eq(patient.clinicId, clinicId),
              or(
                ilike(patient.mrn, `%${q}%`),
                ilike(patient.fullName, `%${q}%`),
                ilike(patient.phone, `%${q}%`),
              ),
            );
      const rows = await db.select().from(patient).where(filters).limit(limit);
      return rows.map(toPatientRecord);
    },

    async create(clinicId, input) {
      const rows = await db
        .insert(patient)
        .values({
          clinicId,
          mrn: input.mrn,
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth,
          phone: input.phone,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error('patient insert returned no row');
      return toPatientRecord(row);
    },
  };
}

export function createTemplateRepository(db: Db): TemplateRepository {
  return {
    async list(clinicId) {
      const rows = await db
        .select()
        .from(appointmentTemplate)
        .where(
          and(
            eq(appointmentTemplate.clinicId, clinicId),
            eq(appointmentTemplate.active, true),
          ),
        );
      return rows.map(toTemplateRecord);
    },

    async getWithSteps(clinicId, templateId) {
      const templates = await db
        .select()
        .from(appointmentTemplate)
        .where(
          and(
            eq(appointmentTemplate.clinicId, clinicId),
            eq(appointmentTemplate.id, templateId),
          ),
        )
        .limit(1);
      const header = templates[0];
      if (header === undefined) return null;
      const steps = await db
        .select()
        .from(templateStep)
        .where(eq(templateStep.templateId, templateId))
        .orderBy(templateStep.seq);
      return {
        template: toTemplateRecord(header),
        steps: steps.map(toChainStep),
      };
    },

    async create(clinicId, input) {
      return db.transaction(async (tx: DbTransaction) => {
        const headers = await tx
          .insert(appointmentTemplate)
          .values({
            clinicId,
            code: input.code,
            name: input.name,
            isPreset: true,
            active: true,
            createdBy: input.createdBy,
          })
          .returning();
        const header = headers[0];
        if (header === undefined) {
          throw new Error('template insert returned no row');
        }
        if (input.steps.length > 0) {
          await tx.insert(templateStep).values(
            input.steps.map((step) => ({
              templateId: header.id,
              seq: step.seq,
              serviceTypeId: step.serviceTypeId,
              durationMin: step.durationMin,
              minGapMin: step.minGapMin,
              maxGapMin: step.maxGapMin,
              setupMin: step.setupMin,
              teardownMin: step.teardownMin,
              sameResourceAsSeq: step.sameResourceAsSeq,
            })),
          );
        }
        return {
          template: toTemplateRecord(header),
          steps: input.steps,
        };
      });
    },
  };
}

export function createAppointmentRepository(db: Db): AppointmentRepository {
  return {
    async getById(clinicId, appointmentId) {
      const rows = await db
        .select()
        .from(appointment)
        .where(
          and(
            eq(appointment.clinicId, clinicId),
            eq(appointment.id, appointmentId),
          ),
        )
        .limit(1);
      const header = rows[0];
      if (header === undefined) return null;
      const [steps, segments] = await Promise.all([
        db
          .select()
          .from(appointmentStep)
          .where(eq(appointmentStep.appointmentId, appointmentId))
          .orderBy(appointmentStep.seq),
        db
          .select()
          .from(appointmentSegment)
          .where(eq(appointmentSegment.appointmentId, appointmentId))
          .orderBy(appointmentSegment.seq),
      ]);
      return {
        appointment: toAppointmentRecord(header),
        steps: steps.map(toChainStep),
        segments: segments.map(toSegmentRecord),
      };
    },

    async list(args) {
      const conditions = [eq(appointment.clinicId, args.clinicId)];
      if (args.date !== undefined) {
        conditions.push(eq(appointment.onDate, args.date));
      }
      if (args.status !== undefined) {
        conditions.push(eq(appointment.status, args.status));
      }
      if (args.patientId !== undefined) {
        conditions.push(eq(appointment.patientId, args.patientId));
      }

      const q = args.q?.trim();
      if (q !== undefined && q !== '' && args.status !== 'CANCELLED') {
        conditions.push(ne(appointment.status, 'CANCELLED'));
      }
      let headerRows;
      if (q !== undefined && q !== '') {
        headerRows = await db
          .select({ appointment })
          .from(appointment)
          .innerJoin(patient, eq(patient.id, appointment.patientId))
          .where(
            and(
              ...conditions,
              or(
                ilike(patient.mrn, `%${q}%`),
                ilike(patient.fullName, `%${q}%`),
                ilike(patient.phone, `%${q}%`),
              ),
            ),
          )
          .orderBy(appointment.createdAt)
          .limit(args.limit + 1);
      } else {
        headerRows = await db
          .select({ appointment })
          .from(appointment)
          .where(and(...conditions))
          .orderBy(appointment.createdAt)
          .limit(args.limit + 1);
      }

      const rows = headerRows.map((row) => row.appointment);
      const page = rows.slice(0, args.limit);
      const items = [];
      for (const header of page) {
        const [steps, segments] = await Promise.all([
          db
            .select()
            .from(appointmentStep)
            .where(eq(appointmentStep.appointmentId, header.id))
            .orderBy(appointmentStep.seq),
          db
            .select()
            .from(appointmentSegment)
            .where(eq(appointmentSegment.appointmentId, header.id))
            .orderBy(appointmentSegment.seq),
        ]);
        items.push({
          appointment: toAppointmentRecord(header),
          steps: steps.map(toChainStep),
          segments: segments.map(toSegmentRecord),
        });
      }

      return {
        items,
        nextCursor:
          rows.length > args.limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    },

    async insertBooking(tx, input) {
      const client = tx as DbTransaction;
      const headers = await client
        .insert(appointment)
        .values({
          clinicId: input.clinicId,
          patientId: input.patientId,
          templateId: input.templateId,
          templateNameAtBooking: input.templateNameAtBooking,
          onDate: input.onDate,
          status: 'SCHEDULED',
          notes: input.notes,
          createdBy: input.createdBy,
        })
        .returning();
      const header = headers[0];
      if (header === undefined) {
        throw new Error('appointment insert returned no row');
      }

      if (input.steps.length > 0) {
        await client.insert(appointmentStep).values(
          input.steps.map((step) => ({
            appointmentId: header.id,
            seq: step.seq,
            serviceTypeId: step.serviceTypeId,
            durationMin: step.durationMin,
            minGapMin: step.minGapMin,
            maxGapMin: step.maxGapMin,
            setupMin: step.setupMin,
            teardownMin: step.teardownMin,
            sameResourceAsSeq: step.sameResourceAsSeq,
          })),
        );
      }

      const segmentRows =
        input.segments.length === 0
          ? []
          : await client
              .insert(appointmentSegment)
              .values(
                input.segments.map((segment) => ({
                  appointmentId: header.id,
                  clinicId: input.clinicId,
                  patientId: input.patientId,
                  seq: segment.seq,
                  kind: segment.kind,
                  serviceTypeId: segment.serviceTypeId,
                  resourceId: segment.resourceId,
                  during: formatTstzrange(
                    segment.patientStart,
                    segment.patientEnd,
                  ),
                  resourceDuring:
                    segment.resourceStart === null ||
                    segment.resourceEnd === null
                      ? null
                      : formatTstzrange(
                          segment.resourceStart,
                          segment.resourceEnd,
                        ),
                  status: 'ACTIVE' as const,
                })),
              )
              .returning();

      return {
        appointment: toAppointmentRecord(header),
        segments: segmentRows.map(toSegmentRecord),
      };
    },

    async replaceSegments(tx, args) {
      const client = tx as DbTransaction;
      await client
        .update(appointmentSegment)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(appointmentSegment.appointmentId, args.appointmentId),
            eq(appointmentSegment.status, 'ACTIVE'),
          ),
        );

      if (args.segments.length === 0) return [];

      const rows = await client
        .insert(appointmentSegment)
        .values(
          args.segments.map((segment) => ({
            appointmentId: args.appointmentId,
            clinicId: args.clinicId,
            patientId: args.patientId,
            seq: segment.seq,
            kind: segment.kind,
            serviceTypeId: segment.serviceTypeId,
            resourceId: segment.resourceId,
            during: formatTstzrange(segment.patientStart, segment.patientEnd),
            resourceDuring:
              segment.resourceStart === null || segment.resourceEnd === null
                ? null
                : formatTstzrange(segment.resourceStart, segment.resourceEnd),
            status: 'ACTIVE' as const,
          })),
        )
        .returning();

      await client
        .update(appointment)
        .set({ updatedAt: sql`now()` })
        .where(eq(appointment.id, args.appointmentId));

      return rows.map(toSegmentRecord);
    },

    async updateStatus(tx, args) {
      const client = tx as DbTransaction;
      const rows = await client
        .update(appointment)
        .set({
          status: args.status,
          ...(args.notes === undefined ? {} : { notes: args.notes }),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(appointment.clinicId, args.clinicId),
            eq(appointment.id, args.appointmentId),
          ),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('appointment status update returned no row');
      }

      if (
        args.status === 'CANCELLED' ||
        args.status === 'COMPLETED' ||
        args.status === 'NO_SHOW'
      ) {
        await client
          .update(appointmentSegment)
          .set({ status: 'CANCELLED' })
          .where(
            and(
              eq(appointmentSegment.appointmentId, args.appointmentId),
              eq(appointmentSegment.status, 'ACTIVE'),
            ),
          );
      }

      return toAppointmentRecord(row);
    },
  };
}

export function createAuditRepository(_db: Db): AuditRepository {
  return {
    async append(tx, row) {
      const client = tx as DbTransaction;
      await client.insert(auditLog).values({
        clinicId: row.clinicId,
        actorId: row.actorId,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        before: row.before ?? null,
        after: row.after ?? null,
      });
    },
  };
}

export function createIdempotencyRepository(db: Db): IdempotencyRepository {
  return {
    async find(clinicId, key) {
      const rows = await db
        .select()
        .from(idempotencyRecord)
        .where(
          and(
            eq(idempotencyRecord.clinicId, clinicId),
            eq(idempotencyRecord.key, key),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        requestHash: row.requestHash,
        statusCode: row.statusCode,
        response: row.response,
      };
    },

    async save(row) {
      await db
        .insert(idempotencyRecord)
        .values({
          clinicId: row.clinicId,
          key: row.key,
          requestHash: row.requestHash,
          method: row.method,
          path: row.path,
          statusCode: row.statusCode,
          response: row.response,
        })
        .onConflictDoNothing();
    },
  };
}

function toPatientRecord(row: typeof patient.$inferSelect): PatientRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    mrn: row.mrn,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth,
    phone: row.phone,
    createdAt: row.createdAt,
  };
}

function toTemplateRecord(
  row: typeof appointmentTemplate.$inferSelect,
): TemplateRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    code: row.code,
    name: row.name,
    isPreset: row.isPreset,
    active: row.active,
  };
}

function toAppointmentRecord(
  row: typeof appointment.$inferSelect,
): AppointmentRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientId: row.patientId,
    templateId: row.templateId,
    templateNameAtBooking: row.templateNameAtBooking,
    onDate: row.onDate,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChainStep(
  row: typeof templateStep.$inferSelect | typeof appointmentStep.$inferSelect,
): ChainStep {
  return {
    seq: row.seq,
    serviceTypeId: row.serviceTypeId,
    durationMin: row.durationMin,
    minGapMin: row.minGapMin,
    maxGapMin: row.maxGapMin,
    setupMin: row.setupMin,
    teardownMin: row.teardownMin,
    ...(row.sameResourceAsSeq === null
      ? {}
      : { sameResourceAsSeq: row.sameResourceAsSeq }),
  };
}

export type { SegmentRecord };
