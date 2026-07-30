import { describe, expect, it } from 'vitest';

import { isFree, occupy, slotRange } from './slot-mask.js';

describe('slotRange', () => {
  it('sets one bit for a single-slot range', () => {
    expect(slotRange(0, 1)).toBe(0b1n);
    expect(slotRange(3, 1)).toBe(0b1000n);
  });

  it('sets contiguous bits starting at the given slot', () => {
    // slots 2,3,4 busy -> 0b11100
    expect(slotRange(2, 3)).toBe(0b11100n);
  });

  it('returns an empty mask for a zero-length range', () => {
    expect(slotRange(5, 0)).toBe(0n);
  });

  it('addresses slots well beyond 64 without overflow', () => {
    // A bigint mask has no width limit, which is why the engine uses one
    // rather than a fixed-width number.
    expect(slotRange(100, 2)).toBe(0b11n << 100n);
  });

  it.each([
    ['negative start', -1, 2],
    ['negative length', 0, -1],
    ['fractional start', 1.5, 2],
    ['fractional length', 0, 2.5],
    ['non-finite start', Number.NaN, 1],
  ])('rejects %s', (_label, start, length) => {
    expect(() => slotRange(start, length)).toThrow(RangeError);
  });
});

describe('isFree', () => {
  it('is true when nothing is busy', () => {
    expect(isFree(0n, 0, 36)).toBe(true);
  });

  it('is false when the range overlaps a busy slot', () => {
    const busy = slotRange(4, 1);
    expect(isFree(busy, 3, 3)).toBe(false);
    expect(isFree(busy, 4, 1)).toBe(false);
  });

  it('is true for ranges that merely abut a busy range', () => {
    const busy = slotRange(4, 2); // slots 4,5
    expect(isFree(busy, 2, 2)).toBe(true); // slots 2,3 — ends where busy starts
    expect(isFree(busy, 6, 2)).toBe(true); // slots 6,7 — starts where busy ends
  });

  it('treats a zero-length range as always free', () => {
    expect(isFree(slotRange(0, 36), 10, 0)).toBe(true);
  });
});

describe('occupy', () => {
  it('adds a range to an existing mask', () => {
    expect(occupy(slotRange(0, 2), 4, 2)).toBe(0b110011n);
  });

  it('is idempotent — occupying the same range twice changes nothing', () => {
    const once = occupy(0n, 3, 4);
    expect(occupy(once, 3, 4)).toBe(once);
  });

  it('round-trips against isFree', () => {
    const busy = occupy(0n, 7, 3);
    expect(isFree(busy, 7, 3)).toBe(false);
    expect(isFree(busy, 10, 3)).toBe(true);
  });
});
