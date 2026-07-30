import { z } from 'zod';

/**
 * The label lists are declared as `const` tuples and everything else is derived
 * from them: the Zod schema that validates at the HTTP boundary, the TypeScript
 * union, and the `pgEnum` Drizzle uses to type queries. One list, three
 * consumers, so a label cannot be added in one place and forgotten in another.
 *
 * Migration 0000 spells the same labels out literally. That duplication is
 * deliberate: a migration must never depend on code that can change after the
 * migration has been applied. An integration test asserts the two agree.
 */

/**
 * The clinic's three capacity-1 resource kinds.
 *
 * The patient is also a capacity-1 resource (ADR 0003) but is deliberately not a
 * member of this union: patients are not schedulable inventory the clinic owns.
 */
export const RESOURCE_TYPES = ['DOCTOR', 'NMT_ROOM', 'SCAN_ROOM'] as const;
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

/**
 * Whether a booked block holds a clinical resource or is a mandatory clinical
 * wait. A `DELAY` occupies the patient and nothing else.
 */
export const SEGMENT_KINDS = ['SERVICE', 'DELAY'] as const;
export const segmentKindSchema = z.enum(SEGMENT_KINDS);
export type SegmentKind = z.infer<typeof segmentKindSchema>;

/**
 * A segment's own lifecycle, independent of its appointment's. `CANCELLED`
 * segments are excluded from the overlap exclusion constraints, which is how
 * cancelling frees a slot without deleting history.
 */
export const SEGMENT_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export const segmentStatusSchema = z.enum(SEGMENT_STATUSES);
export type SegmentStatus = z.infer<typeof segmentStatusSchema>;

/** Where an appointment sits in the clinic's front-desk workflow. */
export const APPOINTMENT_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/**
 * Every enum keyed by its Postgres type name, in declaration order. Exported so
 * that an integration test can query `pg_enum` and assert the database labels
 * and these lists have not drifted apart.
 */
export const ENUM_VALUES = {
  resource_type: RESOURCE_TYPES,
  segment_kind: SEGMENT_KINDS,
  segment_status: SEGMENT_STATUSES,
  appointment_status: APPOINTMENT_STATUSES,
} as const;
