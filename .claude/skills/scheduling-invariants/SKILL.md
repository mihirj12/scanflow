---
name: scheduling-invariants
description: The correctness contract for packages/scheduling-core. Use before writing, modifying, or reviewing any scheduling engine code, adding a constraint, or changing the ranking function. Any change to the engine requires a matching property test.
---

# Scheduling engine invariants

`packages/scheduling-core` is pure: no framework, no I/O, no async, no
dependencies. If you are about to add a dependency, stop.

Purity is enforced mechanically by `scripts/check-purity.mjs`, which runs as part
of `pnpm lint` for this package. It fails the build on a non-relative import, on
`async` / `await` / `Promise`, and on `Math.random`, `Date.now`, `new Date`,
`process.*`, `console.*`, or `setTimeout`. The last group is about determinism as
much as purity.

## The nine properties

Every candidate returned by `suggestPlacements` must satisfy all of these,
verified by fast-check at 1,000+ runs:

1. No resource appears in two overlapping resource intervals, and no resource
   interval intersects that resource's busyMask.
2. The patient interval intersects neither patientBusyMask nor another segment.
3. Every inter-step gap lies within that step's [minGapSlots, maxGapSlots].
4. Every interval, including setup and teardown, lies within [0, totalSlots).
5. Every sameResourceAsSeq reference resolves to an identical resource id.
6. Each placement's patient interval length equals its step's durationSlots, and
   delays are represented as DELAY placements.
7. Identical input produces deeply equal output (determinism).
8. Results are sorted by spanSlots ascending.
9. Freeing a busy slot never worsens the best span (monotonicity).

The generator must produce random clinics with 1–4 resources per type, random
chains of 2–6 steps with random durations and gap windows, and random existing
occupancy. A generator that only ever makes one doctor leaves the
resource-selection logic untested.

## Objective

Minimise `spanSlots`. Because `Σ durations + Σ minGaps` is fixed for a given
chain, this is exactly equivalent to minimising incidental gap:

```
incidentalGapSlots = spanSlots − Σ durationSlots − Σ minGapSlots
```

Tie-break order: spanSlots, then startSlot, then total assigned-resource load
(which spreads work across a pool), then concatenated resource ids
lexicographically. The last one exists purely so that output is deterministic.

Return at most `maxCandidates`, deduplicated by (startSlot, resource assignment).

## Implementation requirements

- Occupancy is a bigint bitmask, one bit per slot. Conflict checking is a single
  `&`. Use `slotRange`, `isFree`, and `occupy` from `slot-mask.ts`.
- Non-working hours are folded into `busyMask` by the caller. The engine has no
  concept of clock time, only slot indices.
- Maintain a per-search overlay mask per resource. Steps 1 and 5 may use the same
  doctor; without the overlay the engine can overlap a resource with itself once
  setup/teardown are non-zero.
- The patient interval is one unbroken range from the first step's start to the
  last step's end, because delays occupy the patient. Re-check it as `end` grows.
- Iterate resources in sorted id order. Determinism is a tested property.
- Try gaps smallest-first: it finds good solutions early and makes the bound
  effective. But a smaller gap at step 2 can force a larger one at step 3, so
  **do not return the first complete solution** — run the full bounded search.
- The engine has no concept of templates. It receives `EngineStep[]` and must not
  learn what a `templateId` is.
- Invalid input (zero duration, `maxGap < minGap`) is rejected by validation, not
  silently accepted. An unschedulable-but-valid request returns an empty array,
  never an exception.

## Adding a constraint

1. Add the property test first, and watch it fail.
2. Extend EngineStep or EngineResource.
3. Implement inside the DFS.
4. Confirm all nine existing properties still pass.
5. Re-run the benchmark; p95 must stay under 50 ms.
