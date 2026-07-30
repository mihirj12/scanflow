import type { AppointmentStatus } from '@scanflow/contracts';
import { describe, expect, it } from 'vitest';

import { kebabActionsFor } from './status-actions';

describe('kebabActionsFor', () => {
  it('omits illegal moves for SCHEDULED and stays within five items', () => {
    const actions = kebabActionsFor('SCHEDULED');
    expect(actions.map((a) => a.id)).toEqual([
      'check-in',
      'reschedule',
      'cancel',
      'no-show',
      'print',
    ]);
    expect(actions).toHaveLength(5);
  });

  it('omits check-in once the visit has started', () => {
    const actions = kebabActionsFor('IN_PROGRESS' satisfies AppointmentStatus);
    expect(actions.map((a) => a.id)).toContain('complete');
    expect(actions.map((a) => a.id)).not.toContain('check-in');
    expect(actions.map((a) => a.id)).not.toContain('no-show');
  });
});
