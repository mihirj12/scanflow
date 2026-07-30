import { describe, expect, it } from 'vitest';

import { allowedTransitions, canTransition } from './status-transitions.js';

describe('appointment status transitions', () => {
  it('allows the front-desk path from SCHEDULED', () => {
    expect(allowedTransitions('SCHEDULED')).toEqual([
      'CHECKED_IN',
      'CANCELLED',
      'NO_SHOW',
    ]);
    expect(canTransition('SCHEDULED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('SCHEDULED', 'COMPLETED')).toBe(false);
  });

  it('treats same-status as allowed', () => {
    expect(canTransition('IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
  });
});
