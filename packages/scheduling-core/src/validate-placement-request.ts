import { InvalidPlacementRequestError } from './errors.js';
import type { PlacementRequest } from './types.js';

/**
 * Checks that a request is well formed, and throws if it is not.
 *
 * The line this draws is between a *malformed* request and an *unsatisfiable*
 * one. A zero-duration step is malformed: no answer to it exists, so it is a
 * caller bug. A six-hour chain in a nine-hour day that happens to be fully
 * booked is unsatisfiable but perfectly well formed, and the honest answer is
 * an empty candidate list — so nothing here rejects a chain for being too long,
 * for wanting a resource type the clinic does not own, or for being impossible
 * given today's occupancy.
 *
 * @param request - The request to check.
 * @throws InvalidPlacementRequestError listing every problem found, so a caller
 *   fixing them does not have to iterate one message at a time.
 */
export function validatePlacementRequest(request: PlacementRequest): void {
  const problems: string[] = [];

  if (!isPositiveInteger(request.totalSlots)) {
    problems.push(
      `totalSlots must be a positive integer, got ${String(request.totalSlots)}`,
    );
  }
  if (!isPositiveInteger(request.maxCandidates)) {
    problems.push(
      `maxCandidates must be a positive integer, got ${String(request.maxCandidates)}`,
    );
  }
  if (request.patientBusyMask < 0n) {
    problems.push(
      `patientBusyMask must not be negative, got ${String(request.patientBusyMask)}`,
    );
  }

  const seenResourceIds = new Set<string>();
  for (const resource of request.resources) {
    if (seenResourceIds.has(resource.id)) {
      problems.push(`duplicate resource id '${resource.id}'`);
    }
    seenResourceIds.add(resource.id);
    if (resource.busyMask < 0n) {
      problems.push(
        `busyMask of resource '${resource.id}' must not be negative`,
      );
    }
  }

  if (request.steps.length === 0) {
    problems.push('steps must not be empty');
  }

  // Resolving sameResourceAsSeq by array position is only sound if seq values
  // are exactly 1..n, so that is checked rather than assumed.
  const typeBySeq = new Map<number, string>();
  request.steps.forEach((step, index) => {
    const expectedSeq = index + 1;
    if (step.seq !== expectedSeq) {
      problems.push(
        `steps must have contiguous seq values starting at 1; position ${String(index)} has seq ${String(step.seq)}, expected ${String(expectedSeq)}`,
      );
    }
    typeBySeq.set(step.seq, step.resourceType);

    const at = `step ${String(step.seq)}`;
    if (!isPositiveInteger(step.durationSlots)) {
      problems.push(
        `${at}: durationSlots must be a positive integer, got ${String(step.durationSlots)}`,
      );
    }
    if (!isNonNegativeInteger(step.setupSlots)) {
      problems.push(
        `${at}: setupSlots must be a non-negative integer, got ${String(step.setupSlots)}`,
      );
    }
    if (!isNonNegativeInteger(step.teardownSlots)) {
      problems.push(
        `${at}: teardownSlots must be a non-negative integer, got ${String(step.teardownSlots)}`,
      );
    }
    if (!isNonNegativeInteger(step.minGapSlots)) {
      problems.push(
        `${at}: minGapSlots must be a non-negative integer, got ${String(step.minGapSlots)}`,
      );
    }
    if (!isNonNegativeInteger(step.maxGapSlots)) {
      problems.push(
        `${at}: maxGapSlots must be a non-negative integer, got ${String(step.maxGapSlots)}`,
      );
    } else if (step.maxGapSlots < step.minGapSlots) {
      problems.push(
        `${at}: maxGapSlots (${String(step.maxGapSlots)}) must be at least minGapSlots (${String(step.minGapSlots)})`,
      );
    }
  });

  for (const step of request.steps) {
    const target = step.sameResourceAsSeq;
    if (target === undefined) continue;
    if (target >= step.seq) {
      problems.push(
        `step ${String(step.seq)}: sameResourceAsSeq must reference an earlier step, got ${String(target)}`,
      );
      continue;
    }
    const targetType = typeBySeq.get(target);
    if (targetType === undefined) {
      problems.push(
        `step ${String(step.seq)}: sameResourceAsSeq references step ${String(target)}, which does not exist`,
      );
    } else if (targetType !== step.resourceType) {
      // Pinning a scan to a doctor cannot be satisfied by any resource, so it
      // is a modelling mistake rather than a tight constraint.
      problems.push(
        `step ${String(step.seq)}: sameResourceAsSeq references step ${String(target)} of type ${targetType}, but this step needs a ${step.resourceType}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new InvalidPlacementRequestError(problems);
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
