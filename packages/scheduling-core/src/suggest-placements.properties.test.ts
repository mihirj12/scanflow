// A namespace import rather than the default export: fast-check publishes both,
// and reading arbitraries off the default trips import-x/no-named-as-default-member.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isFree, occupy, slotRange } from './slot-mask.js';
import { suggestPlacements } from './suggest-placements.js';
import type {
  Candidate,
  EngineResource,
  EngineStep,
  Placement,
  PlacementRequest,
  ResourceTypeName,
} from './types.js';

/**
 * The nine invariants of the scheduling engine, as fast-check properties.
 *
 * These are the specification, not a regression net: every one of them is a
 * sentence a clinician would recognise, and any of them failing means the
 * engine has proposed a clinically or physically impossible appointment.
 *
 * The generator deliberately builds clinics with up to four resources per type.
 * A generator that only ever makes one doctor leaves the resource-selection
 * logic — the part most likely to be wrong — completely untested.
 */

const TOTAL_SLOTS = 36;
const RUNS = 1000;
const RESOURCE_TYPES: readonly ResourceTypeName[] = [
  'DOCTOR',
  'NMT_ROOM',
  'SCAN_ROOM',
];

/**
 * Occupancy as booked intervals rather than uniformly random bits. Random bits
 * would make almost every generated day unschedulable, and a property that
 * mostly asserts things about empty arrays proves nothing.
 *
 * Two densities, because they test different things. Quiet days check that the
 * engine finds the obvious answer; busy days are the ones that force it to
 * spend incidental gap, which is what exercises the search and its bound.
 */
function bookedIntervals(
  maxCount: number,
  maxLength: number,
): fc.Arbitrary<bigint> {
  return fc
    .array(
      fc.record({
        start: fc.integer({ min: 0, max: TOTAL_SLOTS - 1 }),
        length: fc.integer({ min: 1, max: maxLength }),
      }),
      { maxLength: maxCount },
    )
    .map((intervals) =>
      intervals.reduce(
        (mask, { start, length }) =>
          occupy(mask, start, Math.min(length, TOTAL_SLOTS - start)),
        0n,
      ),
    );
}

const occupancyArb = fc.oneof(
  { weight: 1, arbitrary: bookedIntervals(4, 4) },
  { weight: 1, arbitrary: bookedIntervals(10, 6) },
);

const clinicArb = fc
  .tuple(
    fc.array(occupancyArb, { minLength: 1, maxLength: 4 }),
    fc.array(occupancyArb, { minLength: 1, maxLength: 4 }),
    fc.array(occupancyArb, { minLength: 1, maxLength: 4 }),
  )
  .map(([doctors, nmtRooms, scanRooms]): readonly EngineResource[] =>
    [doctors, nmtRooms, scanRooms].flatMap((masks, typeIndex) => {
      const type = RESOURCE_TYPES[typeIndex] ?? 'DOCTOR';
      return masks.map((busyMask, index) => ({
        id: `${type}-${String(index)}`,
        type,
        modalities: [],
        busyMask,
      }));
    }),
  );

const chainArb = fc
  .array(
    fc.record({
      resourceType: fc.constantFrom(...RESOURCE_TYPES),
      durationSlots: fc.integer({ min: 1, max: 4 }),
      minGapSlots: fc.integer({ min: 0, max: 4 }),
      extraGapSlots: fc.integer({ min: 0, max: 3 }),
      // Non-zero setup and teardown are never seeded in production (spec 2.4)
      // but are generated here, because they are the only way a resource can
      // collide with itself and so the only thing that exercises the overlay.
      setupSlots: fc.integer({ min: 0, max: 1 }),
      teardownSlots: fc.integer({ min: 0, max: 1 }),
      pinSelector: fc.option(fc.nat({ max: 5 }), { nil: undefined }),
    }),
    { minLength: 2, maxLength: 6 },
  )
  .map((raws): readonly EngineStep[] =>
    raws.map((raw, index) => {
      const earlierSameType = raws
        .slice(0, index)
        .flatMap((other, otherIndex) =>
          other.resourceType === raw.resourceType ? [otherIndex + 1] : [],
        );
      const pinnedTo =
        raw.pinSelector === undefined || earlierSameType.length === 0
          ? undefined
          : earlierSameType[raw.pinSelector % earlierSameType.length];

      return {
        seq: index + 1,
        resourceType: raw.resourceType,
        durationSlots: raw.durationSlots,
        setupSlots: raw.setupSlots,
        teardownSlots: raw.teardownSlots,
        // The first step has no predecessor to measure a delay from.
        minGapSlots: index === 0 ? 0 : raw.minGapSlots,
        maxGapSlots: index === 0 ? 0 : raw.minGapSlots + raw.extraGapSlots,
        ...(pinnedTo === undefined ? {} : { sameResourceAsSeq: pinnedTo }),
      };
    }),
  );

const requestArb: fc.Arbitrary<PlacementRequest> = fc
  .record({
    steps: chainArb,
    resources: clinicArb,
    // Usually free: a patient being booked is normally free, and a busy patient
    // mask mostly just makes the day unschedulable.
    patientBusyMask: fc.oneof(
      { weight: 3, arbitrary: fc.constant(0n) },
      { weight: 1, arbitrary: bookedIntervals(4, 4) },
    ),
    maxCandidates: fc.integer({ min: 1, max: 5 }),
  })
  .map((parts) => ({ ...parts, totalSlots: TOTAL_SLOTS }));

function servicePlacements(candidate: Candidate): readonly Placement[] {
  return candidate.placements.filter(
    (placement) => placement.kind === 'SERVICE',
  );
}

function stepBySeq(request: PlacementRequest, seq: number): EngineStep {
  const step = request.steps.find((candidate) => candidate.seq === seq);
  if (step === undefined) {
    throw new Error(`candidate references unknown step seq ${String(seq)}`);
  }
  return step;
}

function resourceById(request: PlacementRequest, id: string): EngineResource {
  const resource = request.resources.find((candidate) => candidate.id === id);
  if (resource === undefined) {
    throw new Error(`candidate references unknown resource '${id}'`);
  }
  return resource;
}

/** Positions of the set bits inside the day, ascending. */
function busySlots(mask: bigint): number[] {
  const positions: number[] = [];
  for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
    if (!isFree(mask, slot, 1)) positions.push(slot);
  }
  return positions;
}

/**
 * A guard on the nine properties below rather than a property itself.
 *
 * Every invariant is phrased "for every candidate returned", so a generator
 * that mostly produced unschedulable days would make the whole suite pass
 * vacuously while proving nothing. This measures the generator and fails if it
 * drifts into that state.
 */
describe('the generator', () => {
  it('produces days that are mostly schedulable and structurally varied', () => {
    const samples = fc.sample(requestArb, { numRuns: 400, seed: 20260729 });

    let schedulable = 0;
    let withPin = 0;
    let withSetupOrTeardown = 0;
    let withResourcePool = 0;
    let withIncidentalGap = 0;
    let candidateCount = 0;

    for (const request of samples) {
      const candidates = suggestPlacements(request);
      candidateCount += candidates.length;
      if (candidates.length > 0) schedulable++;
      if (candidates.some((candidate) => candidate.incidentalGapSlots > 0)) {
        withIncidentalGap++;
      }
      if (request.steps.some((step) => step.sameResourceAsSeq !== undefined)) {
        withPin++;
      }
      if (
        request.steps.some(
          (step) => step.setupSlots > 0 || step.teardownSlots > 0,
        )
      ) {
        withSetupOrTeardown++;
      }
      for (const type of RESOURCE_TYPES) {
        if (request.resources.filter((r) => r.type === type).length > 1) {
          withResourcePool++;
          break;
        }
      }
    }

    const percent = (count: number): number =>
      Math.round((count / samples.length) * 100);
    console.log(
      [
        `schedulable            ${String(percent(schedulable))}%`,
        `candidates per request ${(candidateCount / samples.length).toFixed(2)}`,
        `chains with a pin      ${String(percent(withPin))}%`,
        `chains with setup/teardown ${String(percent(withSetupOrTeardown))}%`,
        `clinics with a pool    ${String(percent(withResourcePool))}%`,
        `days needing slack     ${String(percent(withIncidentalGap))}%`,
      ].join('\n'),
    );

    // Deliberately loose: these guard against a generator that has become
    // degenerate, not against ordinary drift in the random distribution.
    expect(percent(schedulable)).toBeGreaterThan(50);
    expect(percent(withPin)).toBeGreaterThan(20);
    expect(percent(withSetupOrTeardown)).toBeGreaterThan(40);
    expect(percent(withResourcePool)).toBeGreaterThan(60);
    expect(percent(withIncidentalGap)).toBeGreaterThan(5);
  });
});

describe('suggestPlacements invariants', () => {
  it('1. never overlaps a resource with another booking or with itself', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        for (const candidate of suggestPlacements(request)) {
          const held = new Map<string, bigint>();

          for (const placement of servicePlacements(candidate)) {
            const { resourceId, resourceStartSlot, resourceEndSlot } =
              placement;
            expect(resourceId).not.toBeNull();
            expect(resourceStartSlot).not.toBeNull();
            expect(resourceEndSlot).not.toBeNull();
            if (
              resourceId === null ||
              resourceStartSlot === null ||
              resourceEndSlot === null
            ) {
              continue;
            }

            const interval = slotRange(
              resourceStartSlot,
              resourceEndSlot - resourceStartSlot,
            );
            const resource = resourceById(request, resourceId);

            // Against the world: nothing already booked, and no closed hours.
            expect(resource.busyMask & interval).toBe(0n);
            // Against itself: two steps sharing a resource must not collide,
            // which setup and teardown make possible even when the patient
            // intervals are disjoint.
            const alreadyHeld = held.get(resourceId) ?? 0n;
            expect(alreadyHeld & interval).toBe(0n);
            held.set(resourceId, alreadyHeld | interval);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('2. never double-books the patient, who is occupied continuously', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        for (const candidate of suggestPlacements(request)) {
          const whole = slotRange(candidate.startSlot, candidate.spanSlots);
          expect(request.patientBusyMask & whole).toBe(0n);

          // Segments tile the span exactly: no overlap, and no hole either,
          // because a waiting patient is still on site.
          let cursor = candidate.startSlot;
          for (const placement of candidate.placements) {
            expect(placement.patientStartSlot).toBe(cursor);
            expect(placement.patientEndSlot).toBeGreaterThan(cursor);
            cursor = placement.patientEndSlot;
          }
          expect(cursor).toBe(candidate.endSlot);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('3. keeps every gap inside its step[minGapSlots, maxGapSlots] window', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        for (const candidate of suggestPlacements(request)) {
          const services = servicePlacements(candidate);
          let previousEnd: number | undefined;

          for (const placement of services) {
            if (previousEnd !== undefined) {
              const step = stepBySeq(request, placement.seq);
              const gap = placement.patientStartSlot - previousEnd;
              // The lower bound is the clinical one. Compressing it produces an
              // appointment that is invalid however convenient it looks.
              expect(gap).toBeGreaterThanOrEqual(step.minGapSlots);
              expect(gap).toBeLessThanOrEqual(step.maxGapSlots);
            }
            previousEnd = placement.patientEndSlot;
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('4. keeps every interval, setup and teardown included, inside the day', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        for (const candidate of suggestPlacements(request)) {
          expect(candidate.startSlot).toBeGreaterThanOrEqual(0);
          expect(candidate.endSlot).toBeLessThanOrEqual(request.totalSlots);

          for (const placement of candidate.placements) {
            expect(placement.patientStartSlot).toBeGreaterThanOrEqual(0);
            expect(placement.patientEndSlot).toBeLessThanOrEqual(
              request.totalSlots,
            );
            if (placement.resourceStartSlot !== null) {
              expect(placement.resourceStartSlot).toBeGreaterThanOrEqual(0);
            }
            if (placement.resourceEndSlot !== null) {
              expect(placement.resourceEndSlot).toBeLessThanOrEqual(
                request.totalSlots,
              );
            }
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('5. resolves every sameResourceAsSeq to an identical resource id', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        for (const candidate of suggestPlacements(request)) {
          const assigned = new Map<number, string | null>();
          for (const placement of servicePlacements(candidate)) {
            assigned.set(placement.seq, placement.resourceId);
          }

          for (const step of request.steps) {
            const pinnedTo = step.sameResourceAsSeq;
            if (pinnedTo === undefined) continue;
            expect(assigned.get(step.seq)).toBe(assigned.get(pinnedTo));
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('6. preserves every duration and represents each wait as a DELAY', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        for (const candidate of suggestPlacements(request)) {
          const services = servicePlacements(candidate);
          expect(services).toHaveLength(request.steps.length);

          for (const placement of services) {
            const step = stepBySeq(request, placement.seq);
            expect(placement.patientEndSlot - placement.patientStartSlot).toBe(
              step.durationSlots,
            );
            expect(placement.resourceStartSlot).toBe(
              placement.patientStartSlot - step.setupSlots,
            );
            expect(placement.resourceEndSlot).toBe(
              placement.patientEndSlot + step.teardownSlots,
            );
          }

          // Every wait is a DELAY that holds the patient and no resource, and
          // there are no DELAYs that are not waits.
          let previousEnd: number | undefined;
          for (const placement of services) {
            if (previousEnd !== undefined) {
              const gap = placement.patientStartSlot - previousEnd;
              const delays = candidate.placements.filter(
                (other) =>
                  other.kind === 'DELAY' &&
                  other.patientStartSlot === previousEnd,
              );
              expect(delays).toHaveLength(gap > 0 ? 1 : 0);
              if (gap > 0) {
                expect(delays[0]).toMatchObject({
                  seq: placement.seq,
                  resourceId: null,
                  patientEndSlot: placement.patientStartSlot,
                  resourceStartSlot: null,
                  resourceEndSlot: null,
                });
              }
            }
            previousEnd = placement.patientEndSlot;
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('7. is deterministic: identical input gives deeply equal output', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        expect(suggestPlacements(request)).toStrictEqual(
          suggestPlacements(request),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('8. returns candidates sorted by span, then start, ascending', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const candidates = suggestPlacements(request);
        expect(candidates.length).toBeLessThanOrEqual(request.maxCandidates);

        let previous: Candidate | undefined;
        const seen = new Set<string>();
        for (const candidate of candidates) {
          if (previous !== undefined) {
            expect(candidate.spanSlots).toBeGreaterThanOrEqual(
              previous.spanSlots,
            );
            if (candidate.spanSlots === previous.spanSlots) {
              expect(candidate.startSlot).toBeGreaterThanOrEqual(
                previous.startSlot,
              );
            }
          }
          // Deduplicated by (startSlot, resource assignment).
          const key = `${String(candidate.startSlot)}#${servicePlacements(
            candidate,
          )
            .map((placement) => placement.resourceId)
            .join('>')}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          previous = candidate;
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('9. is monotonic: freeing a slot never makes the best span worse', () => {
    fc.assert(
      fc.property(
        requestArb,
        fc.nat(),
        fc.nat(),
        (request, whichResource, whichSlot) => {
          const before = suggestPlacements(request);
          const [bestBefore] = before;
          if (bestBefore === undefined) return;

          // Free one busy slot on one resource, changing nothing else.
          const index = whichResource % request.resources.length;
          const target = request.resources[index];
          if (target === undefined) return;
          const busy = busySlots(target.busyMask);
          if (busy.length === 0) return;
          const slot = busy[whichSlot % busy.length];
          if (slot === undefined) return;

          const relaxed: PlacementRequest = {
            ...request,
            resources: request.resources.map((resource, position) =>
              position === index
                ? {
                    ...resource,
                    busyMask: resource.busyMask & ~slotRange(slot, 1),
                  }
                : resource,
            ),
          };

          const [bestAfter] = suggestPlacements(relaxed);
          // Extra freedom cannot remove a placement that already existed, and it
          // cannot make the best one longer.
          expect(bestAfter).toBeDefined();
          expect(bestAfter?.spanSlots).toBeLessThanOrEqual(
            bestBefore.spanSlots,
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});
