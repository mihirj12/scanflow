import { describe, expect, it } from 'vitest';

import {
  type ChainResource,
  type ChainServiceType,
  type ChainValidationContext,
  parseAppointmentChain,
} from './chain.js';

const services: readonly ChainServiceType[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    resourceType: 'DOCTOR',
    requiredModality: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    resourceType: 'NMT_ROOM',
    requiredModality: null,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    resourceType: 'SCAN_ROOM',
    requiredModality: null,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    resourceType: 'SCAN_ROOM',
    requiredModality: 'PET',
  },
];

const resources: readonly ChainResource[] = [
  { type: 'DOCTOR', modalities: [], active: true },
  { type: 'NMT_ROOM', modalities: [], active: true },
  { type: 'SCAN_ROOM', modalities: ['SPECT'], active: true },
];

const ctx: ChainValidationContext = {
  slotMinutes: 15,
  dayMinutes: 9 * 60,
  serviceTypes: services,
  resources,
};

const doctor = services[0]!.id;
const nmt = services[1]!.id;
const scan = services[2]!.id;
const pet = services[3]!.id;

function step(
  seq: number,
  serviceTypeId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    seq,
    serviceTypeId,
    durationMin: 30,
    minGapMin: seq === 1 ? 0 : 0,
    maxGapMin: seq === 1 ? 0 : 0,
    setupMin: 0,
    teardownMin: 0,
    ...overrides,
  };
}

describe('parseAppointmentChain', () => {
  it('accepts a well-formed single-step chain', () => {
    const result = parseAppointmentChain([step(1, doctor)], ctx);
    expect(result.success).toBe(true);
  });

  it('rejects an empty chain', () => {
    const result = parseAppointmentChain([], ctx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) => /at least one step/i.test(i.message)),
    ).toBe(true);
  });

  it('rejects non-contiguous seq', () => {
    const result = parseAppointmentChain([step(1, doctor), step(3, scan)], ctx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) => /contiguously/i.test(i.message)),
    ).toBe(true);
  });

  it('rejects a gap on step 1', () => {
    const result = parseAppointmentChain(
      [step(1, doctor, { minGapMin: 15, maxGapMin: 15 })],
      ctx,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => /first step/i.test(i.message))).toBe(
      true,
    );
  });

  it('rejects a duration that is not a multiple of slot_minutes', () => {
    const result = parseAppointmentChain(
      [step(1, doctor, { durationMin: 20 })],
      ctx,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) =>
        /multiple of the clinic/i.test(i.message),
      ),
    ).toBe(true);
  });

  it('rejects maxGap below minGap', () => {
    const result = parseAppointmentChain(
      [step(1, doctor), step(2, scan, { minGapMin: 60, maxGapMin: 30 })],
      ctx,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) =>
        /maxGapMin .* at least minGapMin/i.test(i.message),
      ),
    ).toBe(true);
  });

  it('rejects sameResourceAsSeq across resource types', () => {
    const result = parseAppointmentChain(
      [step(1, doctor), step(2, scan, { sameResourceAsSeq: 1 })],
      ctx,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) => /needs a SCAN_ROOM/i.test(i.message)),
    ).toBe(true);
  });

  it('rejects a chain that cannot fit in the working day, naming the span', () => {
    const result = parseAppointmentChain(
      [
        step(1, doctor, { durationMin: 300 }),
        step(2, nmt, { durationMin: 300 }),
      ],
      ctx,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) => /at least 600 minutes/i.test(i.message)),
    ).toBe(true);
  });

  it('rejects a modality no active resource provides', () => {
    const result = parseAppointmentChain([step(1, pet)], ctx);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((i) => /modality 'PET'/i.test(i.message)),
    ).toBe(true);
  });

  it('accepts the uptake-study shape (P4)', () => {
    const result = parseAppointmentChain(
      [
        step(1, doctor, { durationMin: 45 }),
        step(2, nmt, { durationMin: 30 }),
        step(3, scan, { durationMin: 30, minGapMin: 60, maxGapMin: 90 }),
        step(4, scan, { durationMin: 30, sameResourceAsSeq: 3 }),
        step(5, doctor, {
          durationMin: 30,
          minGapMin: 0,
          maxGapMin: 30,
          sameResourceAsSeq: 1,
        }),
      ],
      ctx,
    );
    expect(result.success).toBe(true);
  });
});
