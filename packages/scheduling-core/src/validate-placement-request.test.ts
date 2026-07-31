import { describe, expect, it } from 'vitest';

import { InvalidPlacementRequestError } from './errors.js';
import type { EngineResource, EngineStep, PlacementRequest } from './types.js';
import { validatePlacementRequest } from './validate-placement-request.js';

const doctor: EngineResource = {
  id: 'doctor-1',
  type: 'DOCTOR',
  modalities: [],
  busyMask: 0n,
};

function step(overrides: Partial<EngineStep> = {}): EngineStep {
  return {
    seq: 1,
    resourceType: 'DOCTOR',
    durationSlots: 2,
    setupSlots: 0,
    teardownSlots: 0,
    minGapSlots: 0,
    maxGapSlots: 0,
    ...overrides,
  };
}

function request(overrides: Partial<PlacementRequest> = {}): PlacementRequest {
  return {
    totalSlots: 36,
    steps: [step()],
    resources: [doctor],
    patientBusyMask: 0n,
    maxCandidates: 5,
    ...overrides,
  };
}

/** Every problem this rejects is a caller bug, not an unschedulable request. */
describe('validatePlacementRequest', () => {
  it('accepts a well-formed request', () => {
    expect(() => {
      validatePlacementRequest(request());
    }).not.toThrow();
  });

  it('rejects an empty chain', () => {
    expect(() => {
      validatePlacementRequest(request({ steps: [] }));
    }).toThrow(InvalidPlacementRequestError);
  });

  it('rejects a zero-duration step rather than silently accepting it', () => {
    expect(() => {
      validatePlacementRequest(
        request({ steps: [step({ durationSlots: 0 })] }),
      );
    }).toThrow(/durationSlots/);
  });

  it('rejects a fractional duration', () => {
    expect(() => {
      validatePlacementRequest(
        request({ steps: [step({ durationSlots: 1.5 })] }),
      );
    }).toThrow(/durationSlots/);
  });

  it('rejects maxGapSlots below minGapSlots when a max is set', () => {
    expect(() => {
      validatePlacementRequest(
        request({
          steps: [step(), step({ seq: 2, minGapSlots: 4, maxGapSlots: 2 })],
        }),
      );
    }).toThrow(/maxGapSlots/);
  });

  it('accepts minGapSlots with no max (maxGapSlots 0)', () => {
    expect(() => {
      validatePlacementRequest(
        request({
          steps: [step(), step({ seq: 2, minGapSlots: 4, maxGapSlots: 0 })],
        }),
      );
    }).not.toThrow();
  });

  it('rejects a negative gap', () => {
    expect(() => {
      validatePlacementRequest(
        request({
          steps: [step(), step({ seq: 2, minGapSlots: -1, maxGapSlots: 0 })],
        }),
      );
    }).toThrow(/minGapSlots/);
  });

  it('rejects a fractional gap bound', () => {
    expect(() => {
      validatePlacementRequest(
        request({
          steps: [step(), step({ seq: 2, minGapSlots: 0, maxGapSlots: 2.5 })],
        }),
      );
    }).toThrow(/maxGapSlots/);
  });

  it('rejects a sameResourceAsSeq referencing a step that does not exist', () => {
    expect(() => {
      validatePlacementRequest(
        request({ steps: [step({ seq: 1, sameResourceAsSeq: 0 })] }),
      );
    }).toThrow(/does not exist/);
  });

  it('rejects negative setup or teardown', () => {
    expect(() => {
      validatePlacementRequest(request({ steps: [step({ setupSlots: -1 })] }));
    }).toThrow(/setupSlots/);
    expect(() => {
      validatePlacementRequest(
        request({ steps: [step({ teardownSlots: -1 })] }),
      );
    }).toThrow(/teardownSlots/);
  });

  it('rejects seq values that are not contiguous from 1', () => {
    expect(() => {
      validatePlacementRequest(
        request({ steps: [step({ seq: 1 }), step({ seq: 3 })] }),
      );
    }).toThrow(/seq/);
  });

  it('rejects a sameResourceAsSeq pointing at a later step', () => {
    expect(() => {
      validatePlacementRequest(
        request({
          steps: [step({ seq: 1, sameResourceAsSeq: 2 }), step({ seq: 2 })],
        }),
      );
    }).toThrow(/sameResourceAsSeq/);
  });

  it('rejects a sameResourceAsSeq pointing at itself', () => {
    expect(() => {
      validatePlacementRequest(
        request({ steps: [step({ seq: 1, sameResourceAsSeq: 1 })] }),
      );
    }).toThrow(/sameResourceAsSeq/);
  });

  it('rejects a sameResourceAsSeq across resource types', () => {
    // Pointing a scan step at a doctor step is nonsense and must be rejected
    // rather than silently ignored (spec 2.9 rule 7).
    expect(() => {
      validatePlacementRequest(
        request({
          steps: [
            step({ seq: 1, resourceType: 'DOCTOR' }),
            step({
              seq: 2,
              resourceType: 'SCAN_ROOM',
              sameResourceAsSeq: 1,
            }),
          ],
        }),
      );
    }).toThrow(/sameResourceAsSeq/);
  });

  it('rejects duplicate resource ids', () => {
    expect(() => {
      validatePlacementRequest(
        request({ resources: [doctor, { ...doctor, busyMask: 1n }] }),
      );
    }).toThrow(/duplicate/);
  });

  it('rejects a negative busy mask', () => {
    expect(() => {
      validatePlacementRequest(request({ patientBusyMask: -1n }));
    }).toThrow(/patientBusyMask/);
    expect(() => {
      validatePlacementRequest(
        request({ resources: [{ ...doctor, busyMask: -1n }] }),
      );
    }).toThrow(/busyMask/);
  });

  it('rejects a non-positive totalSlots or maxCandidates', () => {
    expect(() => {
      validatePlacementRequest(request({ totalSlots: 0 }));
    }).toThrow(/totalSlots/);
    expect(() => {
      validatePlacementRequest(request({ maxCandidates: 0 }));
    }).toThrow(/maxCandidates/);
  });

  it('reports every problem at once rather than only the first', () => {
    try {
      validatePlacementRequest(
        request({ totalSlots: 0, steps: [step({ durationSlots: 0 })] }),
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPlacementRequestError);
      const { problems } = error as InvalidPlacementRequestError;
      expect(problems.length).toBeGreaterThan(1);
    }
  });

  /**
   * The distinction that matters most in this file: a chain that cannot fit is
   * a legitimate question with the answer "nowhere", so it is not a validation
   * failure. `suggestPlacements` returns an empty array for it.
   */
  it('accepts a valid chain that cannot possibly fit in the day', () => {
    expect(() => {
      validatePlacementRequest(
        request({
          totalSlots: 4,
          steps: [
            step({ durationSlots: 3 }),
            step({ seq: 2, durationSlots: 3 }),
          ],
        }),
      );
    }).not.toThrow();
  });
});
