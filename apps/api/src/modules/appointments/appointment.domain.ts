import type { AppointmentStatus } from '@scanflow/contracts';

import { InvalidStatusTransitionError } from '../../errors/domain-errors.js';

/**
 * Legal appointment status transitions (spec 2.11).
 *
 * Enforced here rather than with scattered `if` statements so an illegal move
 * always raises the same typed error and the table is the single place to
 * audit the workflow.
 */
const ALLOWED: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/**
 * Asserts that moving from `from` to `to` is legal.
 *
 * @throws InvalidStatusTransitionError when the transition is not in the table.
 */
export function assertStatusTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (from === to) return;
  const next = ALLOWED[from];
  if (!next.includes(to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

/** Returns the statuses reachable in one step from `from`. */
export function allowedTransitions(
  from: AppointmentStatus,
): readonly AppointmentStatus[] {
  return ALLOWED[from];
}
