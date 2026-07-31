import type { ResourceType, UserRole } from './enums.js';

/**
 * Whether `role` may change availability for `target`. ADMIN: all resources;
 * CLINICIAN: own doctor column only; RECEPTIONIST: rooms, not doctors.
 */
export function canEditResourceAvailability(
  role: UserRole,
  actorResourceId: string | null,
  target: { id: string; type: ResourceType },
): boolean {
  if (role === 'ADMIN') return true;
  if (role === 'CLINICIAN') {
    return (
      target.type === 'DOCTOR' &&
      actorResourceId !== null &&
      actorResourceId === target.id
    );
  }
  // RECEPTIONIST: rooms only (only role left).
  return target.type === 'NMT_ROOM' || target.type === 'SCAN_ROOM';
}

/** Reception and admin book; clinicians view the schedule only. */
export function canBookAppointments(role: UserRole): boolean {
  return role === 'RECEPTIONIST' || role === 'ADMIN';
}
