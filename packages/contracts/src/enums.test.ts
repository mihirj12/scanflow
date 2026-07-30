import { describe, expect, it } from 'vitest';

import {
  appointmentStatusSchema,
  ENUM_VALUES,
  resourceTypeSchema,
  segmentKindSchema,
  segmentStatusSchema,
} from './enums.js';

describe('enum schemas', () => {
  it('matches the Postgres enum labels declared in migration 0000', () => {
    // Kept in step by hand here; an integration test in M2 asserts the real
    // database labels against ENUM_VALUES so drift cannot go unnoticed.
    expect(ENUM_VALUES).toStrictEqual({
      resource_type: ['DOCTOR', 'NMT_ROOM', 'SCAN_ROOM'],
      segment_kind: ['SERVICE', 'DELAY'],
      segment_status: ['ACTIVE', 'CANCELLED'],
      appointment_status: [
        'DRAFT',
        'SCHEDULED',
        'CHECKED_IN',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
      ],
    });
  });

  it.each([
    ['resourceType', resourceTypeSchema, 'SCAN_ROOM'],
    ['segmentKind', segmentKindSchema, 'DELAY'],
    ['segmentStatus', segmentStatusSchema, 'CANCELLED'],
    ['appointmentStatus', appointmentStatusSchema, 'NO_SHOW'],
  ])('%s accepts a known label', (_name, schema, value) => {
    expect(schema.parse(value)).toBe(value);
  });

  it.each([
    ['resourceType', resourceTypeSchema],
    ['segmentKind', segmentKindSchema],
    ['segmentStatus', segmentStatusSchema],
    ['appointmentStatus', appointmentStatusSchema],
  ])('%s rejects an unknown label', (_name, schema) => {
    expect(schema.safeParse('PENDING').success).toBe(false);
  });

  it('rejects lower-case spellings, so casing bugs surface at the boundary', () => {
    expect(resourceTypeSchema.safeParse('doctor').success).toBe(false);
  });
});
