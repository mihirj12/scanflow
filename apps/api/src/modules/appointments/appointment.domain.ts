import {
  allowedTransitions as sharedAllowed,
  canTransition,
  type AppointmentStatus,
} from '@scanflow/contracts';

import { InvalidStatusTransitionError } from '../../errors/domain-errors.js';

/**
 * Asserts that moving from `from` to `to` is legal.
 *
 * The transition table lives in `@scanflow/contracts` so the management UI
 * offers the same moves the server will accept.
 *
 * @throws InvalidStatusTransitionError when the transition is not in the table.
 */
export function assertStatusTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

/** Returns the statuses reachable in one step from `from`. */
export function allowedTransitions(
  from: AppointmentStatus,
): readonly AppointmentStatus[] {
  return sharedAllowed(from);
}
