import type { ChainStep, ServiceTypeDto } from '@scanflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  normalizeChainSteps,
  reorderChainSteps,
  summarizeChain,
  validateChainSteps,
} from './chain-editor';

const doctor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const scan = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const serviceTypes: ServiceTypeDto[] = [
  {
    id: doctor,
    code: 'CONSULT',
    name: 'Consultation',
    resourceType: 'DOCTOR',
    requiredModality: null,
  },
  {
    id: scan,
    code: 'SCAN',
    name: 'Scan',
    resourceType: 'SCAN_ROOM',
    requiredModality: 'SPECT',
  },
];

function step(
  seq: number,
  serviceTypeId: string,
  extras: Partial<ChainStep> = {},
): ChainStep {
  return {
    seq,
    serviceTypeId,
    durationMin: 30,
    minGapMin: seq === 1 ? 0 : 15,
    maxGapMin: seq === 1 ? 0 : 15,
    setupMin: 0,
    teardownMin: 0,
    ...extras,
  };
}

describe('summarizeChain', () => {
  it('sums service time, min delays, and min span', () => {
    const summary = summarizeChain([
      step(1, doctor, { durationMin: 45, minGapMin: 0, maxGapMin: 0 }),
      step(2, scan, { durationMin: 30, minGapMin: 60, maxGapMin: 90 }),
    ]);
    expect(summary).toEqual({
      stepCount: 2,
      serviceMinutes: 75,
      minDelayMinutes: 60,
      minSpanMinutes: 135,
    });
  });
});

describe('normalizeChainSteps / reorder', () => {
  it('clears a same-resource link that would dangle after reorder', () => {
    const steps: ChainStep[] = [
      step(1, doctor),
      step(2, doctor, { sameResourceAsSeq: 1, minGapMin: 0, maxGapMin: 0 }),
      step(3, scan, { minGapMin: 60, maxGapMin: 90 }),
    ];
    // Move step 1 (doctor) after step 3 — step 2's link to seq 1 must clear
    // because the target is no longer earlier.
    const reordered = reorderChainSteps(steps, 0, 2, serviceTypes);
    expect(reordered.map((s) => s.seq)).toEqual([1, 2, 3]);
    const second = reordered[1];
    expect(second?.sameResourceAsSeq).toBeUndefined();
  });

  it('repairs same-resource to the new earlier seq after a safe move', () => {
    const steps: ChainStep[] = [
      step(1, scan, { minGapMin: 0, maxGapMin: 0 }),
      step(2, doctor, { minGapMin: 0, maxGapMin: 0 }),
      step(3, doctor, { sameResourceAsSeq: 2, minGapMin: 0, maxGapMin: 0 }),
    ];
    // Swap the two doctors — step 3 still points at the doctor that was seq 2.
    const reordered = reorderChainSteps(steps, 1, 0, serviceTypes);
    // After moving doctor(seq2) to front: [doctor, scan, doctor]
    // The second doctor should link to seq 1.
    const lastDoctor = reordered[2];
    expect(lastDoctor?.serviceTypeId).toBe(doctor);
    expect(lastDoctor?.sameResourceAsSeq).toBe(1);
  });

  it('forces gaps on step 1 to zero', () => {
    const steps = normalizeChainSteps(
      [step(1, doctor, { minGapMin: 15, maxGapMin: 30 })],
      serviceTypes,
    );
    expect(steps[0]?.minGapMin).toBe(0);
    expect(steps[0]?.maxGapMin).toBe(0);
  });
});

describe('validateChainSteps', () => {
  it('rejects a chain whose min span exceeds the working day', () => {
    const result = validateChainSteps(
      [
        step(1, doctor, { durationMin: 240, minGapMin: 0, maxGapMin: 0 }),
        step(2, scan, { durationMin: 240, minGapMin: 120, maxGapMin: 120 }),
      ],
      {
        slotMinutes: 15,
        dayMinutes: 540,
        serviceTypes: serviceTypes.map((s) => ({
          id: s.id,
          resourceType: s.resourceType,
          requiredModality: s.requiredModality,
        })),
        resources: [
          { type: 'DOCTOR', modalities: [], active: true },
          { type: 'SCAN_ROOM', modalities: ['SPECT'], active: true },
        ],
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.message.includes('540'))).toBe(true);
  });
});
