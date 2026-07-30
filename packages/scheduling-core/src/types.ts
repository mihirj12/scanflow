import type { SlotMask } from './slot-mask.js';

/**
 * The three kinds of capacity-1 resource a step can require.
 *
 * The patient is also a capacity-1 resource (ADR 0003) but is deliberately not
 * listed here: a patient is not something a step *requests*, it is the one
 * participant every step shares. It reaches the engine as
 * {@link PlacementRequest.patientBusyMask}.
 */
export type ResourceTypeName = 'DOCTOR' | 'NMT_ROOM' | 'SCAN_ROOM';

/**
 * One step of an appointment chain, already converted from minutes to slot
 * units by the caller.
 *
 * The engine has no concept of templates. A step is a step whether it came from
 * a saved preset or was assembled by hand thirty seconds ago, which is why
 * composable appointments cost this package nothing.
 */
export interface EngineStep {
  /**
   * Position in the chain, 1-based and contiguous. Used as the target of
   * {@link EngineStep.sameResourceAsSeq} and echoed onto every
   * {@link Placement} the step produces.
   */
  seq: number;
  /** Which kind of resource this step consumes. */
  resourceType: ResourceTypeName;
  /**
   * If set, only resources advertising this modality may serve the step. When
   * absent, any resource of the right type will do.
   */
  requiredModality?: string;
  /** How long the patient is with the resource. Must be at least one slot. */
  durationSlots: number;
  /** Slots the resource is held before the patient arrives. Normally zero. */
  setupSlots: number;
  /** Slots the resource is held after the patient leaves. Normally zero. */
  teardownSlots: number;
  /**
   * Shortest permitted delay before this step, measured from the previous
   * step's end.
   *
   * This is a *clinical* minimum — a radiotracer uptake period, not slack — so
   * the engine may never compress it. Ignored for the first step in the chain,
   * which has no predecessor to measure from.
   */
  minGapSlots: number;
  /**
   * Longest permitted delay before this step. Imaging later than this is
   * clinically invalid, so this is a real upper bound and not a preference.
   * Must be at least `minGapSlots`. Ignored for the first step.
   */
  maxGapSlots: number;
  /**
   * If set, this step must be served by the same resource instance as the step
   * with that `seq` — the "same physician reviews as consulted" rule. Must
   * reference an earlier step of the same {@link EngineStep.resourceType}.
   */
  sameResourceAsSeq?: number;
}

/** One bookable resource instance and everything the engine knows about it. */
export interface EngineResource {
  /** Stable identity. Resources are iterated in ascending id order so that
   * output is deterministic, so this must be unique within a request. */
  id: string;
  /** Which step types this resource can serve. */
  type: ResourceTypeName;
  /** Modalities this resource advertises, matched against
   * {@link EngineStep.requiredModality}. */
  modalities: readonly string[];
  /**
   * Slots this resource cannot be used in: bit `i` set means slot `i` is
   * unavailable.
   *
   * Existing bookings *and* non-working hours are folded in together by the
   * caller. The engine therefore has no concept of clock time, opening hours,
   * or dates — only slot indices — which is what keeps it pure and makes its
   * tests readable.
   */
  busyMask: SlotMask;
}

/** Everything {@link suggestPlacements} needs to search one day. */
export interface PlacementRequest {
  /** Slots in the day. 36 for a 15-minute grid over 08:00-17:00. */
  totalSlots: number;
  /** The chain to place, in `seq` order. */
  steps: readonly EngineStep[];
  /** Every resource that could serve any step, in any order. */
  resources: readonly EngineResource[];
  /**
   * Slots the patient is already committed elsewhere.
   *
   * The patient occupies one unbroken range across the whole appointment,
   * including mandatory delays, because a waiting patient is still on site.
   */
  patientBusyMask: SlotMask;
  /** How many ranked candidates to return at most. */
  maxCandidates: number;
}

/**
 * One segment of a proposed appointment: either a step served by a resource or
 * a mandatory delay that holds only the patient.
 *
 * Two intervals rather than one because they genuinely differ (spec 2.4). A
 * service step holds its resource for `[start - setup, end + teardown)` while
 * holding the patient for `[start, end)`; a delay is the mirror case, holding
 * the patient and no resource at all.
 */
export interface Placement {
  /**
   * The `seq` of the step this placement belongs to.
   *
   * A `DELAY` carries the seq of the step it *precedes*, because a delay is
   * defined by the following step's gap window rather than existing
   * independently. So a delay and its step share a seq and are told apart by
   * {@link Placement.kind} — which is exactly how `appointment_segment` stores
   * them, and why that table has no unique constraint on `(appointment, seq)`.
   */
  seq: number;
  /** Whether this segment consumes a resource or is a clinical wait. */
  kind: 'SERVICE' | 'DELAY';
  /** The assigned resource, or `null` for a `DELAY`. */
  resourceId: string | null;
  /** First slot the patient is occupied. */
  patientStartSlot: number;
  /** One past the last slot the patient is occupied. */
  patientEndSlot: number;
  /** First slot the resource is held, or `null` for a `DELAY`. */
  resourceStartSlot: number | null;
  /** One past the last slot the resource is held, or `null` for a `DELAY`. */
  resourceEndSlot: number | null;
}

/** One complete, conflict-free way to place the whole chain. */
export interface Candidate {
  /** Slot the patient arrives — the first step's start. */
  startSlot: number;
  /** One past the slot the patient leaves — the last step's patient end. */
  endSlot: number;
  /** `endSlot - startSlot`: how much of the patient's day this consumes. */
  spanSlots: number;
  /**
   * Slack this placement adds beyond what the chain clinically requires:
   * `spanSlots - Σ durationSlots - Σ minGapSlots`.
   *
   * This is the number the engine minimises, and it is why minimising span is
   * the right objective: the subtracted terms are fixed for a given chain, so
   * the two are the same thing. Zero means every gap is a mandated wait and
   * nothing is wasted.
   */
  incidentalGapSlots: number;
  /** Every segment, delays included, ordered by time. */
  placements: readonly Placement[];
}
