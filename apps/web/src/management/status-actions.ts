import type { AppointmentStatus } from '@scanflow/contracts';
import { allowedTransitions } from '@scanflow/contracts';

import type { StatusActionPath } from '../api/client';

export type KebabActionId =
  | 'check-in'
  | 'start'
  | 'complete'
  | 'reschedule'
  | 'cancel'
  | 'no-show'
  | 'print';

export interface KebabAction {
  id: KebabActionId;
  label: string;
  /** When set, this action posts a status transition to this target. */
  toStatus?: AppointmentStatus;
}

/**
 * Quick actions for the segment kebab. Omitted when illegal for the current
 * status — never shown disabled. Cap of five items (spec 8).
 */
export function kebabActionsFor(
  status: AppointmentStatus,
): readonly KebabAction[] {
  const next = new Set(allowedTransitions(status));
  const actions: KebabAction[] = [];

  if (next.has('CHECKED_IN')) {
    actions.push({ id: 'check-in', label: 'Check in', toStatus: 'CHECKED_IN' });
  }
  if (next.has('IN_PROGRESS')) {
    actions.push({
      id: 'start',
      label: 'Start visit',
      toStatus: 'IN_PROGRESS',
    });
  }
  if (next.has('COMPLETED')) {
    actions.push({
      id: 'complete',
      label: 'Complete',
      toStatus: 'COMPLETED',
    });
  }

  if (
    status === 'DRAFT' ||
    status === 'SCHEDULED' ||
    status === 'CHECKED_IN' ||
    status === 'IN_PROGRESS'
  ) {
    actions.push({ id: 'reschedule', label: 'Reschedule' });
  }

  if (next.has('CANCELLED')) {
    actions.push({ id: 'cancel', label: 'Cancel', toStatus: 'CANCELLED' });
  }
  if (next.has('NO_SHOW')) {
    actions.push({ id: 'no-show', label: 'Mark no-show', toStatus: 'NO_SHOW' });
  }

  actions.push({ id: 'print', label: 'Print summary' });

  return actions.slice(0, 5);
}

/** Drawer-only status moves that did not fit in the kebab's five-item cap. */
export function drawerStatusActions(
  status: AppointmentStatus,
): readonly KebabAction[] {
  const kebabIds = new Set(kebabActionsFor(status).map((a) => a.id));
  const extras: KebabAction[] = [];
  const next = allowedTransitions(status);

  for (const to of next) {
    const mapped = statusToAction(to);
    if (mapped === null) continue;
    if (kebabIds.has(mapped.id)) continue;
    extras.push(mapped);
  }
  return extras;
}

/** The endpoint segment that moves an appointment to `to`, if one exists. */
export function statusActionPath(
  to: AppointmentStatus,
): StatusActionPath | null {
  switch (to) {
    case 'CHECKED_IN':
      return 'check-in';
    case 'IN_PROGRESS':
      return 'start';
    case 'COMPLETED':
      return 'complete';
    case 'CANCELLED':
      return 'cancel';
    case 'NO_SHOW':
      return 'no-show';
    case 'DRAFT':
    case 'SCHEDULED':
      // Reached by booking and rescheduling, not by a status endpoint.
      return null;
    default: {
      const _exhaustive: never = to;
      return _exhaustive;
    }
  }
}

function statusToAction(to: AppointmentStatus): KebabAction | null {
  switch (to) {
    case 'CHECKED_IN':
      return { id: 'check-in', label: 'Check in', toStatus: to };
    case 'IN_PROGRESS':
      return { id: 'start', label: 'Start visit', toStatus: to };
    case 'COMPLETED':
      return { id: 'complete', label: 'Complete', toStatus: to };
    case 'CANCELLED':
      return { id: 'cancel', label: 'Cancel', toStatus: to };
    case 'NO_SHOW':
      return { id: 'no-show', label: 'Mark no-show', toStatus: to };
    case 'SCHEDULED':
      return null;
    case 'DRAFT':
      return null;
    default: {
      const _exhaustive: never = to;
      return _exhaustive;
    }
  }
}
