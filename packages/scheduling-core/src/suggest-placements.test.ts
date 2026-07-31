import { describe, expect, it } from 'vitest';

import { InvalidPlacementRequestError } from './errors.js';
import { occupy } from './slot-mask.js';
import { suggestPlacements } from './suggest-placements.js';
import type {
  Candidate,
  EngineResource,
  EngineStep,
  Placement,
  PlacementRequest,
} from './types.js';

const SLOTS_PER_DAY = 36;

/**
 * P4, the uptake study from spec 2.10, in slot units: the reference
 * spreadsheet's top row read literally. Two adjacent 30-minute scan cells are
 * two sessions on one scanner, not one 60-minute block.
 *
 * Durations 3+2+2+2+2 = 11 slots, mandatory gaps 4 slots, so the minimum span
 * is 15 slots — exactly 225 minutes.
 */
const UPTAKE_STUDY: readonly EngineStep[] = [
  {
    seq: 1,
    resourceType: 'DOCTOR',
    durationSlots: 3,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 0,
  },
  {
    seq: 2,
    resourceType: 'NMT_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 0,
  },
  {
    // The radiotracer uptake period: 60 to 90 minutes, clinical not logistical.
    seq: 3,
    resourceType: 'SCAN_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 4,
    maxGapSlots: 6,
  },
  {
    seq: 4,
    resourceType: 'SCAN_ROOM',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 0,
    sameResourceAsSeq: 3,
  },
  {
    seq: 5,
    resourceType: 'DOCTOR',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 2,
    sameResourceAsSeq: 1,
  },
];

function resource(
  id: string,
  type: EngineResource['type'],
  busyMask = 0n,
): EngineResource {
  return { id, type, modalities: [], busyMask };
}

const ONE_OF_EACH: readonly EngineResource[] = [
  resource('doctor-1', 'DOCTOR'),
  resource('nmt-1', 'NMT_ROOM'),
  resource('scan-1', 'SCAN_ROOM'),
];

function request(overrides: Partial<PlacementRequest> = {}): PlacementRequest {
  return {
    totalSlots: SLOTS_PER_DAY,
    steps: UPTAKE_STUDY,
    resources: ONE_OF_EACH,
    patientBusyMask: 0n,
    maxCandidates: 5,
    ...overrides,
  };
}

function serviceFor(candidate: Candidate, seq: number): Placement {
  const found = candidate.placements.find(
    (placement) => placement.seq === seq && placement.kind === 'SERVICE',
  );
  if (found === undefined) {
    throw new Error(`no SERVICE placement for seq ${String(seq)}`);
  }
  return found;
}

function at(candidates: readonly Candidate[], startSlot: number): Candidate[] {
  return candidates.filter((candidate) => candidate.startSlot === startSlot);
}

describe('suggestPlacements', () => {
  describe('the uptake study in an empty day', () => {
    it('fits at 08:00 with a span of exactly 225 minutes and no wasted time', () => {
      const candidates = suggestPlacements(request());
      const [best] = candidates;

      expect(best).toBeDefined();
      expect(best?.startSlot).toBe(0);
      expect(best?.spanSlots).toBe(15);
      expect(best?.endSlot).toBe(15);
      // 15 slots x 15 minutes = 225 minutes, and every gap in it is mandated.
      expect(best?.incidentalGapSlots).toBe(0);
    });

    it('lays the chain out back to back around the mandatory wait', () => {
      const [best] = suggestPlacements(request());
      if (best === undefined) throw new Error('expected a candidate');

      expect(serviceFor(best, 1)).toMatchObject({
        resourceId: 'doctor-1',
        patientStartSlot: 0,
        patientEndSlot: 3,
      });
      expect(serviceFor(best, 2)).toMatchObject({
        resourceId: 'nmt-1',
        patientStartSlot: 3,
        patientEndSlot: 5,
      });
      expect(serviceFor(best, 3)).toMatchObject({
        resourceId: 'scan-1',
        patientStartSlot: 9,
        patientEndSlot: 11,
      });
      expect(serviceFor(best, 4)).toMatchObject({
        resourceId: 'scan-1',
        patientStartSlot: 11,
        patientEndSlot: 13,
      });
      expect(serviceFor(best, 5)).toMatchObject({
        resourceId: 'doctor-1',
        patientStartSlot: 13,
        patientEndSlot: 15,
      });
    });

    it('represents the uptake wait as a DELAY holding the patient and no resource', () => {
      const [best] = suggestPlacements(request());
      if (best === undefined) throw new Error('expected a candidate');

      const delays = best.placements.filter(
        (placement) => placement.kind === 'DELAY',
      );
      // Only one gap in this chain is non-zero, so only one DELAY exists.
      expect(delays).toHaveLength(1);
      expect(delays[0]).toStrictEqual({
        // The delay carries the seq of the step it precedes.
        seq: 3,
        kind: 'DELAY',
        resourceId: null,
        patientStartSlot: 5,
        patientEndSlot: 9,
        resourceStartSlot: null,
        resourceEndSlot: null,
      });
    });

    it('orders placements by time and covers the patient continuously', () => {
      const [best] = suggestPlacements(request());
      if (best === undefined) throw new Error('expected a candidate');

      let cursor = best.startSlot;
      for (const placement of best.placements) {
        expect(placement.patientStartSlot).toBe(cursor);
        cursor = placement.patientEndSlot;
      }
      expect(cursor).toBe(best.endSlot);
    });

    it('returns candidates ranked by span then start, capped at maxCandidates', () => {
      const candidates = suggestPlacements(request({ maxCandidates: 5 }));

      expect(candidates).toHaveLength(5);
      expect(candidates.map((candidate) => candidate.startSlot)).toStrictEqual([
        0, 1, 2, 3, 4,
      ]);
      expect(candidates.every((candidate) => candidate.spanSlots === 15)).toBe(
        true,
      );
    });
  });

  describe('the mandatory delay is a floor, never a target', () => {
    it('stretches the uptake gap to 75 minutes when 60 is blocked, rather than shortening it to 45', () => {
      const candidates = suggestPlacements(
        request({
          resources: [
            resource('doctor-1', 'DOCTOR'),
            resource('nmt-1', 'NMT_ROOM'),
            // Busy exactly where a 60-minute uptake would put scan session 1.
            resource('scan-1', 'SCAN_ROOM', occupy(0n, 9, 1)),
          ],
          // Ask for every candidate, so the 08:00 start is present to inspect
          // even though later starts score better.
          maxCandidates: 50,
        }),
      );

      const fromEight = at(candidates, 0);
      expect(fromEight).toHaveLength(1);
      const [eightOClock] = fromEight;
      if (eightOClock === undefined) throw new Error('expected a candidate');
      // 75 minutes after the injection ends at slot 5, not 45.
      expect(serviceFor(eightOClock, 3).patientStartSlot).toBe(10);
      expect(eightOClock.incidentalGapSlots).toBe(1);

      // Nowhere in the whole result set is the clinical minimum compressed.
      for (const candidate of candidates) {
        const injectionEnd = serviceFor(candidate, 2).patientEndSlot;
        const gap = serviceFor(candidate, 3).patientStartSlot - injectionEnd;
        expect(gap).toBeGreaterThanOrEqual(4);
        expect(gap).toBeLessThanOrEqual(6);
      }
    });

    it('yields no candidate at a start whose whole [60, 90] window is blocked', () => {
      const candidates = suggestPlacements(
        request({
          resources: [
            resource('doctor-1', 'DOCTOR'),
            resource('nmt-1', 'NMT_ROOM'),
            // Blocks scan session 1 at gaps of 60, 75 and 90 minutes alike.
            resource('scan-1', 'SCAN_ROOM', occupy(0n, 9, 4)),
          ],
          maxCandidates: 50,
        }),
      );

      expect(at(candidates, 0)).toHaveLength(0);
      // Later starts still work, so this is a blocked start and not a dead day.
      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe('same-resource constraints', () => {
    /**
     * Two doctors whose free windows do not overlap. Either one alone can serve
     * one of the two steps, so the chain is only unschedulable *because* both
     * steps must resolve to the same physician.
     */
    const splitDoctors: readonly EngineResource[] = [
      resource('doctor-1', 'DOCTOR', occupy(0n, 2, 2)),
      resource('doctor-2', 'DOCTOR', occupy(0n, 0, 2)),
    ];

    const consultThenReview = (
      sameResource: boolean,
    ): readonly EngineStep[] => [
      {
        seq: 1,
        resourceType: 'DOCTOR',
        durationSlots: 2,
        setupSlots: 0,
        teardownSlots: 0,
        minGapSlots: 0,
        maxGapSlots: 0,
      },
      {
        seq: 2,
        resourceType: 'DOCTOR',
        durationSlots: 2,
        setupSlots: 0,
        teardownSlots: 0,
        minGapSlots: 0,
        maxGapSlots: 0,
        ...(sameResource ? { sameResourceAsSeq: 1 } : {}),
      },
    ];

    it('returns nothing when the pinned doctor is busy at the later step', () => {
      const candidates = suggestPlacements(
        request({
          totalSlots: 4,
          steps: consultThenReview(true),
          resources: splitDoctors,
        }),
      );

      expect(candidates).toStrictEqual([]);
    });

    it('would have found a placement without the constraint, proving it bites', () => {
      const candidates = suggestPlacements(
        request({
          totalSlots: 4,
          steps: consultThenReview(false),
          resources: splitDoctors,
        }),
      );

      expect(candidates.length).toBeGreaterThan(0);
      const [best] = candidates;
      if (best === undefined) throw new Error('expected a candidate');
      expect(serviceFor(best, 1).resourceId).toBe('doctor-1');
      expect(serviceFor(best, 2).resourceId).toBe('doctor-2');
    });

    it('resolves every pinned reference to one identical resource id', () => {
      const twoOfEach: readonly EngineResource[] = [
        resource('doctor-1', 'DOCTOR', occupy(0n, 0, 6)),
        resource('doctor-2', 'DOCTOR'),
        resource('nmt-1', 'NMT_ROOM'),
        resource('scan-1', 'SCAN_ROOM', occupy(0n, 0, 20)),
        resource('scan-2', 'SCAN_ROOM'),
      ];
      const [best] = suggestPlacements(request({ resources: twoOfEach }));
      if (best === undefined) throw new Error('expected a candidate');

      expect(serviceFor(best, 5).resourceId).toBe(
        serviceFor(best, 1).resourceId,
      );
      expect(serviceFor(best, 4).resourceId).toBe(
        serviceFor(best, 3).resourceId,
      );
    });
  });

  describe('unbounded post-injection wait', () => {
    it('allows a gap above min when maxGapSlots is zero (no upper cap)', () => {
      const scanBusy = occupy(0n, 2, 4);
      const candidates = suggestPlacements(
        request({
          steps: [
            {
              seq: 1,
              resourceType: 'DOCTOR',
              durationSlots: 2,
              setupSlots: 0,
              teardownSlots: 0,
              minGapSlots: 0,
              maxGapSlots: 0,
            },
            {
              seq: 2,
              resourceType: 'SCAN_ROOM',
              durationSlots: 2,
              setupSlots: 0,
              teardownSlots: 0,
              minGapSlots: 2,
              maxGapSlots: 0,
            },
          ],
          resources: [
            resource('doctor-1', 'DOCTOR'),
            resource('scan-1', 'SCAN_ROOM', scanBusy),
          ],
        }),
      );

      expect(candidates.length).toBeGreaterThan(0);
      const first = candidates[0]!;
      const scan = serviceFor(first, 2);
      expect(
        scan.patientStartSlot - serviceFor(first, 1).patientEndSlot,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('honest empty results rather than exceptions', () => {
    it('returns nothing for a chain that cannot fit before 17:00', () => {
      // The chain needs 15 slots; the day is one slot too short for it.
      const candidates = suggestPlacements(request({ totalSlots: 14 }));

      expect(candidates).toStrictEqual([]);
    });

    it('returns nothing when a required resource type has no instances', () => {
      const candidates = suggestPlacements(
        request({
          resources: [
            resource('doctor-1', 'DOCTOR'),
            resource('nmt-1', 'NMT_ROOM'),
          ],
        }),
      );

      expect(candidates).toStrictEqual([]);
    });

    it('returns nothing when no resource advertises the required modality', () => {
      const candidates = suggestPlacements(
        request({
          steps: [
            {
              seq: 1,
              resourceType: 'SCAN_ROOM',
              requiredModality: 'PET',
              durationSlots: 2,
              setupSlots: 0,
              teardownSlots: 0,
              minGapSlots: 0,
              maxGapSlots: 0,
            },
          ],
          resources: [
            { ...resource('scan-1', 'SCAN_ROOM'), modalities: ['SPECT'] },
          ],
        }),
      );

      expect(candidates).toStrictEqual([]);
    });

    it('returns nothing for a fully booked day, quickly', () => {
      const fullDay = occupy(0n, 0, SLOTS_PER_DAY);
      const started = performance.now();
      const candidates = suggestPlacements(
        request({
          resources: [
            resource('doctor-1', 'DOCTOR', fullDay),
            resource('nmt-1', 'NMT_ROOM', fullDay),
            resource('scan-1', 'SCAN_ROOM', fullDay),
          ],
        }),
      );
      const elapsed = performance.now() - started;

      expect(candidates).toStrictEqual([]);
      expect(elapsed).toBeLessThan(50);
    });

    it('returns nothing when the patient is busy all day', () => {
      const candidates = suggestPlacements(
        request({ patientBusyMask: occupy(0n, 0, SLOTS_PER_DAY) }),
      );

      expect(candidates).toStrictEqual([]);
    });
  });

  describe('input validation', () => {
    it('rejects a zero-duration step', () => {
      expect(() =>
        suggestPlacements(
          request({
            steps: [
              {
                seq: 1,
                resourceType: 'DOCTOR',
                durationSlots: 0,
                setupSlots: 0,
                teardownSlots: 0,
                minGapSlots: 0,
                maxGapSlots: 0,
              },
            ],
          }),
        ),
      ).toThrow(InvalidPlacementRequestError);
    });

    it('rejects maxGapSlots below minGapSlots', () => {
      expect(() =>
        suggestPlacements(
          request({
            steps: [
              {
                seq: 1,
                resourceType: 'DOCTOR',
                durationSlots: 2,
                setupSlots: 0,
                teardownSlots: 0,
                minGapSlots: 0,
                maxGapSlots: 0,
              },
              {
                seq: 2,
                resourceType: 'DOCTOR',
                durationSlots: 2,
                setupSlots: 0,
                teardownSlots: 0,
                minGapSlots: 4,
                maxGapSlots: 2,
              },
            ],
          }),
        ),
      ).toThrow(InvalidPlacementRequestError);
    });
  });

  describe('setup and teardown', () => {
    it('holds the resource wider than the patient and keeps both inside the day', () => {
      const candidates = suggestPlacements(
        request({
          totalSlots: 8,
          steps: [
            {
              seq: 1,
              resourceType: 'DOCTOR',
              durationSlots: 2,
              setupSlots: 1,
              teardownSlots: 1,
              minGapSlots: 0,
              maxGapSlots: 0,
            },
          ],
          resources: [resource('doctor-1', 'DOCTOR')],
          maxCandidates: 50,
        }),
      );

      const [best] = candidates;
      if (best === undefined) throw new Error('expected a candidate');
      // Setup cannot start before the day does, so the earliest patient start
      // is slot 1 rather than slot 0.
      expect(best.startSlot).toBe(1);
      expect(serviceFor(best, 1)).toMatchObject({
        patientStartSlot: 1,
        patientEndSlot: 3,
        resourceStartSlot: 0,
        resourceEndSlot: 4,
      });
      // Nor can teardown run past the end of the day.
      for (const candidate of candidates) {
        expect(serviceFor(candidate, 1).resourceEndSlot).toBeLessThanOrEqual(8);
      }
    });

    it('never overlaps a resource with itself across adjacent steps', () => {
      // Teardown of step 1 would run into setup of step 2 on a shared doctor,
      // which is exactly what the per-search overlay mask exists to prevent.
      const candidates = suggestPlacements(
        request({
          totalSlots: 12,
          steps: [
            {
              seq: 1,
              resourceType: 'DOCTOR',
              durationSlots: 2,
              setupSlots: 0,
              teardownSlots: 1,
              minGapSlots: 0,
              maxGapSlots: 0,
            },
            {
              seq: 2,
              resourceType: 'DOCTOR',
              durationSlots: 2,
              setupSlots: 1,
              teardownSlots: 0,
              minGapSlots: 0,
              maxGapSlots: 2,
              sameResourceAsSeq: 1,
            },
          ],
          resources: [resource('doctor-1', 'DOCTOR')],
        }),
      );

      const [best] = candidates;
      if (best === undefined) throw new Error('expected a candidate');
      const first = serviceFor(best, 1);
      const second = serviceFor(best, 2);
      expect(first.resourceEndSlot).not.toBeNull();
      expect(second.resourceStartSlot).not.toBeNull();
      // A gap of zero would put teardown and setup in the same slot; the engine
      // must therefore choose a gap of at least one.
      expect(second.resourceStartSlot).toBeGreaterThanOrEqual(
        first.resourceEndSlot ?? 0,
      );
    });
  });

  describe('determinism', () => {
    it('returns deeply equal output for identical input', () => {
      const first = suggestPlacements(request());
      const second = suggestPlacements(request());

      expect(second).toStrictEqual(first);
    });

    it('does not depend on the order resources are supplied in', () => {
      const forward = suggestPlacements(request({ resources: ONE_OF_EACH }));
      const reversed = suggestPlacements(
        request({ resources: [...ONE_OF_EACH].reverse() }),
      );

      expect(reversed).toStrictEqual(forward);
    });
  });
});
