/**
 * Drizzle table definitions for querying.
 *
 * `drizzle/0000_initial.sql` is the authoritative schema, not this file. The
 * constraints that carry the correctness guarantees -- the two EXCLUDE USING
 * gist constraints, the kind/resource CHECK, the containment CHECK, the indexes
 * -- cannot be expressed by Drizzle's schema builder, so migrations are written
 * by hand and `drizzle-kit generate` is not used. See ADR 0001 and
 * .claude/skills/db-migration/SKILL.md.
 *
 * What lives here is the column shape Drizzle needs to type queries. If you add
 * a column, add it in a migration first and mirror it here second.
 */
import {
  APPOINTMENT_STATUSES,
  RESOURCE_TYPES,
  SEGMENT_KINDS,
  SEGMENT_STATUSES,
} from '@scanflow/contracts';
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres enum labels are derived from the same const tuples that back the Zod
 * schemas in `@scanflow/contracts`, so the wire format and the storage format
 * cannot drift apart.
 */
export const resourceTypeEnum = pgEnum('resource_type', RESOURCE_TYPES);
export const segmentKindEnum = pgEnum('segment_kind', SEGMENT_KINDS);
export const segmentStatusEnum = pgEnum('segment_status', SEGMENT_STATUSES);
export const appointmentStatusEnum = pgEnum(
  'appointment_status',
  APPOINTMENT_STATUSES,
);

/**
 * A `tstzrange`, carried as its Postgres literal form (for example
 * `["2026-08-03 08:00:00+00","2026-08-03 08:45:00+00")`).
 *
 * Kept as an opaque string on purpose: a start/end column pair would let a
 * caller write a backwards interval, and the exclusion constraints need a real
 * range type to index. Parsing and formatting belong in the slot/time boundary
 * module, which is the only place in the codebase allowed to convert between
 * instants and slot indices.
 */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});

export const clinic = pgTable('clinic', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** IANA zone, e.g. 'Asia/Kolkata'. One per clinic. */
  timezone: text('timezone').notNull(),
  dayStart: time('day_start').notNull().default('08:00'),
  dayEnd: time('day_end').notNull().default('17:00'),
  slotMinutes: smallint('slot_minutes').notNull().default(15),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const patient = pgTable('patient', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinic.id),
  mrn: text('mrn').notNull(),
  fullName: text('full_name').notNull(),
  dateOfBirth: date('date_of_birth'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const resource = pgTable('resource', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinic.id),
  type: resourceTypeEnum('type').notNull(),
  name: text('name').notNull(),
  /** Imaging capabilities this resource provides; matched against a step's required modality. */
  modalities: text('modalities').array().notNull().default([]),
  displayOrder: smallint('display_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const resourceWorkingHours = pgTable('resource_working_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  resourceId: uuid('resource_id')
    .notNull()
    .references(() => resource.id, { onDelete: 'cascade' }),
  /** 0 = Sunday, matching Postgres `extract(dow)` and JavaScript `getDay()`. */
  weekday: smallint('weekday').notNull(),
  startsAt: time('starts_at').notNull(),
  endsAt: time('ends_at').notNull(),
});

export const resourceException = pgTable('resource_exception', {
  id: uuid('id').primaryKey().defaultRandom(),
  resourceId: uuid('resource_id')
    .notNull()
    .references(() => resource.id, { onDelete: 'cascade' }),
  onDate: date('on_date').notNull(),
  startsAt: time('starts_at').notNull(),
  endsAt: time('ends_at').notNull(),
  /** false blocks the window (a closure); true opens it outside working hours. */
  available: boolean('available').notNull().default(false),
  reason: text('reason'),
});

export const serviceType = pgTable('service_type', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinic.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  resourceType: resourceTypeEnum('resource_type').notNull(),
  requiredModality: text('required_modality'),
});

export const appointmentTemplate = pgTable('appointment_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinic.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isPreset: boolean('is_preset').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templateStep = pgTable('template_step', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => appointmentTemplate.id, { onDelete: 'cascade' }),
  seq: smallint('seq').notNull(),
  serviceTypeId: uuid('service_type_id')
    .notNull()
    .references(() => serviceType.id),
  durationMin: smallint('duration_min').notNull(),
  minGapMin: smallint('min_gap_min').notNull().default(0),
  maxGapMin: smallint('max_gap_min').notNull().default(0),
  setupMin: smallint('setup_min').notNull().default(0),
  teardownMin: smallint('teardown_min').notNull().default(0),
  sameResourceAsSeq: smallint('same_resource_as_seq'),
});

export const appointment = pgTable('appointment', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinic.id),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patient.id),
  /**
   * Provenance only, and NULL for a chain built from scratch. Never join through
   * this to work out what an appointment consists of -- read appointment_step.
   */
  templateId: uuid('template_id').references(() => appointmentTemplate.id),
  templateNameAtBooking: text('template_name_at_booking'),
  onDate: date('on_date').notNull(),
  status: appointmentStatusEnum('status').notNull().default('SCHEDULED'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The authoritative chain for one appointment, snapshotted from a template (or
 * assembled by hand) at booking time. Editing a template in March must not
 * retroactively alter an appointment booked in February; that is why this table
 * duplicates template_step rather than referencing it.
 */
export const appointmentStep = pgTable('appointment_step', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointment.id, { onDelete: 'cascade' }),
  seq: smallint('seq').notNull(),
  serviceTypeId: uuid('service_type_id')
    .notNull()
    .references(() => serviceType.id),
  durationMin: smallint('duration_min').notNull(),
  minGapMin: smallint('min_gap_min').notNull().default(0),
  maxGapMin: smallint('max_gap_min').notNull().default(0),
  setupMin: smallint('setup_min').notNull().default(0),
  teardownMin: smallint('teardown_min').notNull().default(0),
  sameResourceAsSeq: smallint('same_resource_as_seq'),
});

export const appointmentSegment = pgTable('appointment_segment', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointment.id, { onDelete: 'cascade' }),
  /** Denormalised from appointment so the day index and exclusion constraints need no join. */
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinic.id),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patient.id),
  seq: smallint('seq').notNull(),
  kind: segmentKindEnum('kind').notNull(),
  serviceTypeId: uuid('service_type_id').references(() => serviceType.id),
  /** NULL for a DELAY: a mandatory wait holds the patient and no clinical resource. */
  resourceId: uuid('resource_id').references(() => resource.id),
  /** The patient interval: [start, end). */
  during: tstzrange('during').notNull(),
  /** The resource interval: the patient interval widened by setup and teardown. */
  resourceDuring: tstzrange('resource_during'),
  status: segmentStatusEnum('status').notNull().default('ACTIVE'),
});

/**
 * Optimistic concurrency token for one clinic-day. A booking locks this row,
 * compares the client's version, then bumps it -- which serialises concurrent
 * bookings for the same day without locking the whole segment table.
 */
export const scheduleVersion = pgTable(
  'schedule_version',
  {
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinic.id),
    onDate: date('on_date').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.onDate] })],
);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  clinicId: uuid('clinic_id').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id'),
  /**
   * Snapshots of the changed row. Never write a patient identifier into these:
   * the audit log is read by more people than the appointment table is.
   */
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  clinic,
  patient,
  resource,
  resourceWorkingHours,
  resourceException,
  serviceType,
  appointmentTemplate,
  templateStep,
  appointment,
  appointmentStep,
  appointmentSegment,
  scheduleVersion,
  auditLog,
};
