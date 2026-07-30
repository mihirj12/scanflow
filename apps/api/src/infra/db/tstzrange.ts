/**
 * Format and parse `tstzrange` literals. The only other place allowed to touch
 * absolute time is `day-grid.mapper.ts`; this file only serialises what that
 * mapper already produced.
 */

/** Formats a half-open `[start, end)` as a Postgres `tstzrange` literal. */
export function formatTstzrange(start: Date, end: Date): string {
  return `["${toPgTimestamptz(start)}","${toPgTimestamptz(end)}")`;
}

/**
 * Parses a `tstzrange` literal into `{ start, end }`.
 * Accepts both quoted and unquoted bounds as returned by postgres.js.
 */
export function parseTstzrange(literal: string): { start: Date; end: Date } {
  const match = /[[(]"?([^"',\]]+)"?,\s*"?([^"')\]]+)"?[\])]/.exec(literal);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new RangeError(`cannot parse tstzrange literal: ${literal}`);
  }
  const start = new Date(match[1]);
  const end = new Date(match[2]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError(`cannot parse tstzrange bounds: ${literal}`);
  }
  return { start, end };
}

function toPgTimestamptz(value: Date): string {
  // UTC ISO-8601 is unambiguous and accepted by Postgres for timestamptz.
  return value.toISOString();
}
