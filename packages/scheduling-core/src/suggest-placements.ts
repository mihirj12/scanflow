import { isFree, occupy } from './slot-mask.js';
import type { SlotMask } from './slot-mask.js';
import type {
  Candidate,
  EngineResource,
  EngineStep,
  Placement,
  PlacementRequest,
} from './types.js';
import { validatePlacementRequest } from './validate-placement-request.js';

/**
 * One step with everything the search needs precomputed, linked to the step
 * that follows it.
 *
 * A linked list rather than an index into an array because the search is a
 * depth-first walk of the chain, and "the next step" is the only navigation it
 * ever performs.
 */
interface StepPlan {
  readonly step: EngineStep;
  /** Resources of the right type and modality, in ascending id order. */
  readonly eligible: readonly EngineResource[];
  /**
   * Fewest slots from this step's start to the end of the whole chain, taking
   * every remaining duration and every remaining *minimum* gap.
   *
   * This is what makes the bound admissible: no completion of the chain from
   * here can finish sooner, so a branch whose `start + minTail` already loses
   * to the worst kept candidate cannot be rescued by anything downstream.
   */
  readonly minTail: number;
  readonly next: StepPlan | undefined;
}

/** A step tentatively placed on the current search path. */
interface Chosen {
  readonly step: EngineStep;
  readonly resourceId: string;
  readonly start: number;
  readonly end: number;
  readonly resourceStart: number;
  readonly resourceEnd: number;
}

/** A candidate plus the precomputed values its ranking depends on. */
interface Ranked {
  /** `(startSlot, resource assignment)` — the deduplication identity. */
  readonly key: string;
  /** Assigned resource ids in chain order, the final deterministic tie-break. */
  readonly ids: string;
  /** Busy slots across the distinct resources used, to spread work in a pool. */
  readonly load: number;
  readonly candidate: Candidate;
}

/**
 * Finds the best ways to place a chain of steps into one day.
 *
 * Minimises `spanSlots`, which is exactly equivalent to minimising wasted time:
 * `Σ durationSlots + Σ minGapSlots` is fixed for a given chain, so every slot
 * of span beyond that sum is incidental gap caused by a busy resource. The
 * mandatory delays inside the chain are never compressed to achieve it — a
 * radiotracer uptake period is a clinical requirement, and a scheduler that
 * treats it as slack produces clinically invalid appointments.
 *
 * The search is depth-first over the chain with branch and bound, trying the
 * tightest gap first. It runs to completion rather than returning the first
 * solution it finds, because a tighter gap at step 2 can force a looser one at
 * step 3.
 *
 * Pure, synchronous and deterministic: the same request always produces the
 * same array, down to the order of ties, which is what lets the property tests
 * assert on it.
 *
 * **This function never books anything.** It proposes; a human chooses.
 *
 * @param request - The chain, the day's occupancy, and how many suggestions to
 *   return. Slot units throughout; the engine has no concept of clock time.
 * @returns Up to `maxCandidates` candidates, best first, ranked by span, then
 *   start, then resource load, then resource ids. Empty when the chain cannot
 *   be placed at all — which is an answer, not a failure.
 * @throws InvalidPlacementRequestError if the request is malformed, for example
 *   a zero-duration step or a `maxGapSlots` below its `minGapSlots`. Being
 *   unschedulable is not malformed.
 */
export function suggestPlacements(request: PlacementRequest): Candidate[] {
  validatePlacementRequest(request);

  const { totalSlots, steps, patientBusyMask, maxCandidates } = request;

  // Sorted once, so output does not depend on the order the caller's query
  // happened to return rows in. Determinism is a tested property.
  const resources = [...request.resources].sort((left, right) =>
    compareStrings(left.id, right.id),
  );

  const loadById = new Map<string, number>();
  for (const resource of resources) {
    loadById.set(resource.id, countSetBits(resource.busyMask));
  }

  const entries = steps.map((step) => ({
    step,
    eligible: resources.filter((resource) => serves(resource, step)),
  }));

  // A step that no resource can serve makes the chain unschedulable today. The
  // honest answer is "nowhere", not an exception.
  if (entries.some((entry) => entry.eligible.length === 0)) return [];

  const head = entries.reduceRight<StepPlan | undefined>(
    (next, entry) => ({
      step: entry.step,
      eligible: entry.eligible,
      minTail:
        entry.step.durationSlots +
        (next === undefined ? 0 : next.step.minGapSlots + next.minTail),
      next,
    }),
    undefined,
  );
  // Unreachable: validation rejects an empty chain. Returning the same empty
  // result the rest of this function would is cheaper than a type assertion.
  if (head === undefined) return [];

  /** The shortest span any placement of this chain could possibly have. */
  const minSpan = head.minTail;
  if (minSpan > totalSlots) return [];

  const kept: Ranked[] = [];
  /**
   * Span of the worst candidate currently held, or infinity while there is
   * still room. Any branch that cannot beat this is abandoned.
   */
  let worstKeptSpan = Number.POSITIVE_INFINITY;
  /** Slots this appointment has tentatively taken, per resource id. */
  const overlay = new Map<string, SlotMask>();
  const assignedBySeq = new Map<number, string>();
  const chosen: Chosen[] = [];
  let searchStart = 0;

  function refreshBound(): void {
    const worst = kept.length < maxCandidates ? undefined : kept.at(-1);
    worstKeptSpan =
      worst === undefined
        ? Number.POSITIVE_INFINITY
        : worst.candidate.spanSlots;
  }

  function keep(ranked: Ranked): void {
    // Two gap distributions can reach the same start with the same resources;
    // they are the same suggestion to a receptionist, so only the better
    // survives. Replacing rather than merely skipping is a safety net for the
    // case the spec warns about — a tighter gap early forcing a looser one
    // later — where the first layout found for a key need not be the best.
    const duplicate = kept.findIndex((held) => held.key === ranked.key);
    if (duplicate !== -1) {
      const held = kept[duplicate];
      if (held !== undefined && compareRanked(held, ranked) <= 0) return;
      kept.splice(duplicate, 1);
    }
    kept.push(ranked);
    kept.sort(compareRanked);
    if (kept.length > maxCandidates) kept.length = maxCandidates;
    refreshBound();
  }

  function record(end: number): void {
    const ids = chosen.map((entry) => entry.resourceId).join('>');
    let load = 0;
    for (const id of new Set(chosen.map((entry) => entry.resourceId))) {
      load += loadById.get(id) ?? 0;
    }

    const spanSlots = end - searchStart;
    keep({
      key: `${String(searchStart)}#${ids}`,
      ids,
      load,
      candidate: {
        startSlot: searchStart,
        endSlot: end,
        spanSlots,
        // Equivalent to `span - Σ durations - Σ minGaps`, because that sum is
        // precisely the shortest span the chain can have.
        incidentalGapSlots: spanSlots - minSpan,
        placements: buildPlacements(chosen),
      },
    });
  }

  function optionsFor(plan: StepPlan): readonly EngineResource[] {
    const pinnedTo = plan.step.sameResourceAsSeq;
    if (pinnedTo === undefined) return plan.eligible;
    const required = assignedBySeq.get(pinnedTo);
    // Unreachable: validation guarantees the target is an earlier step, and the
    // search assigns in chain order.
    if (required === undefined) return [];
    // Filtering the eligible list rather than the whole pool keeps the type and
    // modality checks applied to the pinned resource too.
    return plan.eligible.filter((resource) => resource.id === required);
  }

  function place(plan: StepPlan, start: number): void {
    const { step } = plan;
    const end = start + step.durationSlots;

    // The patient occupies one unbroken range from arrival, delays included,
    // because a waiting patient is still on site. So the whole prefix is
    // re-checked as it grows rather than each segment in isolation.
    if (!isFree(patientBusyMask, searchStart, end - searchStart)) return;

    const resourceStart = start - step.setupSlots;
    const resourceEnd = end + step.teardownSlots;
    if (resourceStart < 0 || resourceEnd > totalSlots) return;
    const resourceLength = resourceEnd - resourceStart;

    for (const resource of optionsFor(plan)) {
      const alreadyHeld = overlay.get(resource.id) ?? 0n;
      // The overlay is what stops a resource overlapping *itself*: steps 1 and
      // 5 may share a doctor, and once setup or teardown is non-zero their
      // resource intervals can collide even though the patient intervals do not.
      if (
        !isFree(resource.busyMask | alreadyHeld, resourceStart, resourceLength)
      ) {
        continue;
      }

      overlay.set(
        resource.id,
        occupy(alreadyHeld, resourceStart, resourceLength),
      );
      assignedBySeq.set(step.seq, resource.id);
      chosen.push({
        step,
        resourceId: resource.id,
        start,
        end,
        resourceStart,
        resourceEnd,
      });

      if (plan.next === undefined) record(end);
      else explore(plan.next, end);

      chosen.pop();
      assignedBySeq.delete(step.seq);
      overlay.set(resource.id, alreadyHeld);
    }
  }

  function explore(plan: StepPlan, cursor: number): void {
    // Ascending, so the tightest legal delay is tried first: it finds good
    // solutions early, which is what makes the bound below bite.
    for (let gap = plan.step.minGapSlots; gap <= plan.step.maxGapSlots; gap++) {
      const start = cursor + gap;
      const earliestEnd = start + plan.minTail;
      if (earliestEnd > totalSlots) break;
      // Strictly greater, so candidates that merely tie on span are still
      // explored — they can still win on start, load, or ids.
      if (earliestEnd - searchStart > worstKeptSpan) break;
      place(plan, start);
    }
  }

  for (let startSlot = 0; startSlot + minSpan <= totalSlots; startSlot++) {
    // Every kept candidate is already as short as this chain can be. A later
    // start can at best tie on span, and then loses the startSlot tie-break.
    if (kept.length === maxCandidates && worstKeptSpan === minSpan) break;
    // Cheap rejection: the patient must be free for at least the minimum span.
    if (!isFree(patientBusyMask, startSlot, minSpan)) continue;
    searchStart = startSlot;
    place(head, startSlot);
  }

  return kept.map((held) => held.candidate);
}

/**
 * Turns a completed search path into segments, inserting a `DELAY` wherever the
 * chain waits.
 */
function buildPlacements(chosen: readonly Chosen[]): readonly Placement[] {
  const placements: Placement[] = [];
  let previousEnd: number | undefined;

  for (const entry of chosen) {
    if (previousEnd !== undefined && entry.start > previousEnd) {
      placements.push({
        // A delay belongs to the step it precedes, because it is that step's
        // gap window that defines it.
        seq: entry.step.seq,
        kind: 'DELAY',
        resourceId: null,
        patientStartSlot: previousEnd,
        patientEndSlot: entry.start,
        resourceStartSlot: null,
        resourceEndSlot: null,
      });
    }
    placements.push({
      seq: entry.step.seq,
      kind: 'SERVICE',
      resourceId: entry.resourceId,
      patientStartSlot: entry.start,
      patientEndSlot: entry.end,
      resourceStartSlot: entry.resourceStart,
      resourceEndSlot: entry.resourceEnd,
    });
    previousEnd = entry.end;
  }

  return placements;
}

function compareRanked(left: Ranked, right: Ranked): number {
  const bySpan = left.candidate.spanSlots - right.candidate.spanSlots;
  if (bySpan !== 0) return bySpan;
  const byStart = left.candidate.startSlot - right.candidate.startSlot;
  if (byStart !== 0) return byStart;
  const byLoad = left.load - right.load;
  if (byLoad !== 0) return byLoad;
  return compareStrings(left.ids, right.ids);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function serves(resource: EngineResource, step: EngineStep): boolean {
  if (resource.type !== step.resourceType) return false;
  const modality = step.requiredModality;
  return modality === undefined || resource.modalities.includes(modality);
}

function countSetBits(mask: SlotMask): number {
  let remaining = mask;
  let count = 0;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) count++;
    remaining >>= 1n;
  }
  return count;
}
