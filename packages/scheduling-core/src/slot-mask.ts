/**
 * Occupancy for one resource over one day, one bit per slot: bit `i` set means
 * slot `i` is unavailable.
 *
 * A `bigint` rather than a `number` because 36 slots fits in a double today but
 * a 5-minute grid would not, and because bit twiddling on `bigint` stays exact
 * at any width. Conflict detection is then a single `&`, which is what lets the
 * search explore thousands of placements inside the 50 ms budget.
 */
export type SlotMask = bigint;

/**
 * Builds a mask with `lengthSlots` consecutive bits set, starting at
 * `startSlot`.
 *
 * @param startSlot - Zero-based index of the first occupied slot.
 * @param lengthSlots - Number of consecutive slots occupied. Zero yields an
 *   empty mask, which is the correct representation of an empty interval.
 * @returns A mask with exactly `lengthSlots` bits set at positions
 *   `startSlot .. startSlot + lengthSlots - 1`.
 * @throws RangeError if either argument is not a non-negative integer. Slot
 *   indices come from the caller's arithmetic, so a fractional or negative
 *   value is a programming error and must not silently produce a wrong mask.
 */
export function slotRange(startSlot: number, lengthSlots: number): SlotMask {
  assertSlotIndex(startSlot, 'startSlot');
  assertSlotIndex(lengthSlots, 'lengthSlots');
  if (lengthSlots === 0) return 0n;
  return ((1n << BigInt(lengthSlots)) - 1n) << BigInt(startSlot);
}

/**
 * Reports whether the interval `[startSlot, startSlot + lengthSlots)` is
 * entirely unoccupied in `busy`.
 *
 * @param busy - Occupancy to test against.
 * @param startSlot - Zero-based index of the first slot of the interval.
 * @param lengthSlots - Length of the interval in slots. A zero-length interval
 *   is always free.
 * @returns `true` when no bit of the interval is set in `busy`.
 * @throws RangeError under the same conditions as {@link slotRange}.
 */
export function isFree(
  busy: SlotMask,
  startSlot: number,
  lengthSlots: number,
): boolean {
  return (busy & slotRange(startSlot, lengthSlots)) === 0n;
}

/**
 * Returns `busy` with the interval `[startSlot, startSlot + lengthSlots)`
 * additionally marked occupied.
 *
 * Purely functional: the input mask is never modified. The search relies on
 * that, because it needs the parent branch's occupancy back unchanged when it
 * backtracks.
 *
 * @param busy - Occupancy to add to.
 * @param startSlot - Zero-based index of the first slot to occupy.
 * @param lengthSlots - Number of slots to occupy.
 * @returns A new mask that is the union of `busy` and the given interval.
 * @throws RangeError under the same conditions as {@link slotRange}.
 */
export function occupy(
  busy: SlotMask,
  startSlot: number,
  lengthSlots: number,
): SlotMask {
  return busy | slotRange(startSlot, lengthSlots);
}

function assertSlotIndex(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer, got ${String(value)}`,
    );
  }
}
