/**
 * Thrown when a {@link PlacementRequest} is malformed — a zero-duration step, a
 * `maxGapSlots` below its `minGapSlots`, a `sameResourceAsSeq` pointing
 * nowhere sensible.
 *
 * A typed error rather than a bare `Error` so the HTTP layer can map it to a
 * 422 without string-matching a message, and so callers can read
 * {@link problems} instead of parsing prose.
 *
 * This is deliberately *not* how the engine reports "this chain will not fit
 * today". A chain that cannot be placed is a legitimate question with the
 * answer "nowhere", and {@link suggestPlacements} answers it with an empty
 * array. Reserving the exception for caller bugs keeps the two apart.
 */
export class InvalidPlacementRequestError extends Error {
  /** Every problem found, so one round trip fixes them all. Never empty. */
  readonly problems: readonly string[];

  /**
   * @param problems - One entry per rule broken, each naming the field at
   *   fault. Must not be empty; an error with nothing wrong with it is a bug.
   */
  constructor(problems: readonly string[]) {
    super(`invalid placement request: ${problems.join('; ')}`);
    this.name = 'InvalidPlacementRequestError';
    this.problems = problems;
  }
}
