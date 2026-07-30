import { describe, expect, it } from 'vitest';

import { InvalidStatusTransitionError } from '../../errors/domain-errors.js';

import {
  allowedTransitions,
  assertStatusTransition,
} from './appointment.domain.js';

describe('appointment status transitions', () => {
  it('allows SCHEDULED → CHECKED_IN and SCHEDULED → CANCELLED', () => {
    expect(() => {
      assertStatusTransition('SCHEDULED', 'CHECKED_IN');
    }).not.toThrow();
    expect(() => {
      assertStatusTransition('SCHEDULED', 'CANCELLED');
    }).not.toThrow();
    expect(allowedTransitions('SCHEDULED')).toEqual([
      'CHECKED_IN',
      'CANCELLED',
      'NO_SHOW',
    ]);
  });

  it('rejects COMPLETED → anything', () => {
    expect(() => {
      assertStatusTransition('COMPLETED', 'CANCELLED');
    }).toThrow(InvalidStatusTransitionError);
  });

  it('rejects SCHEDULED → COMPLETED (must check in first)', () => {
    expect(() => {
      assertStatusTransition('SCHEDULED', 'COMPLETED');
    }).toThrow(InvalidStatusTransitionError);
  });

  it('is a no-op when the status does not change', () => {
    expect(() => {
      assertStatusTransition('SCHEDULED', 'SCHEDULED');
    }).not.toThrow();
  });
});
