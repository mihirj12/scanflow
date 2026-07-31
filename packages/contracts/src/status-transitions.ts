import type { AppointmentStatus } from './enums.js';

/**
 * Legal appointment status transitions (spec 2.11). Shared by the API and the
 * management UI so the kebab/drawer never offer a move the server will reject.
 */
export const APPOINTMENT_STATUS_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW', 'SCHEDULED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Statuses reachable in one step from `from`. */
export function allowedTransitions(
  from: AppointmentStatus,
): readonly AppointmentStatus[] {
  return APPOINTMENT_STATUS_TRANSITIONS[from];
}

/** True when moving from `from` to `to` is legal (same status is allowed). */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  if (from === to) return true;
  return APPOINTMENT_STATUS_TRANSITIONS[from].includes(to);
}
