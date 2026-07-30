import { DateTime, Duration } from 'luxon';

/**
 * Clinic facts the slot/time boundary needs. Everything else in the codebase
 * speaks either slots or timestamps; only this module converts between them.
 */
export interface ClinicDayGrid {
  /** IANA zone, e.g. `Asia/Kolkata`. */
  timezone: string;
  /** Local wall-clock opening time as `HH:mm` or `HH:mm:ss`. */
  dayStart: string;
  /** Local wall-clock closing time as `HH:mm` or `HH:mm:ss`. */
  dayEnd: string;
  slotMinutes: number;
}

/** One booked (or closed) interval already in absolute time. */
export interface BusyInterval {
  start: Date;
  end: Date;
}

/**
 * Builds the half-open day window `[dayStart, dayEnd)` for a calendar date in
 * the clinic's timezone.
 *
 * @param clinic - Opening hours and zone.
 * @param date - Calendar date as `YYYY-MM-DD` in the clinic's local calendar.
 * @returns `{ start, end, totalSlots }` where `end` is exclusive.
 * @throws RangeError if the timezone is unknown, the date is malformed, or the
 *   day length is not an exact multiple of `slotMinutes`.
 */
export function clinicDayWindow(
  clinic: ClinicDayGrid,
  date: string,
): { start: DateTime; end: DateTime; totalSlots: number } {
  const start = localOnDate(clinic, date, clinic.dayStart);
  const end = localOnDate(clinic, date, clinic.dayEnd);
  if (end <= start) {
    throw new RangeError(
      `dayEnd (${clinic.dayEnd}) must be after dayStart (${clinic.dayStart})`,
    );
  }
  const dayMinutes = end.diff(start, 'minutes').minutes;
  if (dayMinutes % clinic.slotMinutes !== 0) {
    throw new RangeError(
      `working day of ${String(dayMinutes)} minutes is not a multiple of slotMinutes (${String(clinic.slotMinutes)})`,
    );
  }
  return {
    start,
    end,
    totalSlots: dayMinutes / clinic.slotMinutes,
  };
}

/**
 * Working-day length in minutes. Used by chain validation rule 8.
 */
export function clinicDayMinutes(clinic: ClinicDayGrid, date: string): number {
  const { start, end } = clinicDayWindow(clinic, date);
  return end.diff(start, 'minutes').minutes;
}

/**
 * Converts a slot index on a clinic-day into the absolute instant at which that
 * slot begins.
 *
 * @param clinic - Opening hours and zone.
 * @param date - Calendar date as `YYYY-MM-DD`.
 * @param slotIndex - Zero-based index; slot 0 is `dayStart`.
 * @returns A `Date` at the start of the slot, in UTC under the hood.
 * @throws RangeError if the slot lies outside `[0, totalSlots)`.
 */
export function slotToInstant(
  clinic: ClinicDayGrid,
  date: string,
  slotIndex: number,
): Date {
  const { start, totalSlots } = clinicDayWindow(clinic, date);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > totalSlots) {
    // `totalSlots` is allowed: it is the exclusive end of the last slot.
    throw new RangeError(
      `slotIndex ${String(slotIndex)} is outside [0, ${String(totalSlots)}]`,
    );
  }
  return start
    .plus(Duration.fromObject({ minutes: slotIndex * clinic.slotMinutes }))
    .toJSDate();
}

/**
 * Converts an absolute instant into the slot index that contains it on the
 * given clinic-day.
 *
 * Instants that fall on a slot boundary belong to the slot that *starts* there
 * (half-open). An instant exactly at `dayEnd` is rejected — it is outside the
 * day, not the start of a phantom last slot.
 *
 * @throws RangeError if the instant falls outside `[dayStart, dayEnd)`.
 */
export function instantToSlot(
  clinic: ClinicDayGrid,
  date: string,
  instant: Date,
): number {
  const { start, end, totalSlots } = clinicDayWindow(clinic, date);
  const at = DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(
    clinic.timezone,
  );
  if (at < start || at >= end) {
    throw new RangeError(
      `instant ${instant.toISOString()} falls outside the clinic day [${start.toISO() ?? ''}, ${end.toISO() ?? ''})`,
    );
  }
  const minutes = at.diff(start, 'minutes').minutes;
  if (minutes % clinic.slotMinutes !== 0) {
    throw new RangeError(
      `instant ${instant.toISOString()} is not aligned to a ${String(clinic.slotMinutes)}-minute slot boundary`,
    );
  }
  const slot = minutes / clinic.slotMinutes;
  if (slot < 0 || slot >= totalSlots) {
    throw new RangeError(
      `slot ${String(slot)} is outside [0, ${String(totalSlots)})`,
    );
  }
  return slot;
}

/**
 * Builds a busy bitmask for one resource (or the patient) on one clinic-day.
 *
 * Bits cover the whole day. Closed hours and existing bookings are OR'd in so
 * the engine never has to know about clock time. Intervals that only partially
 * overlap the day are clipped; intervals wholly outside it are ignored.
 *
 * @param clinic - Opening hours and zone.
 * @param date - Calendar date as `YYYY-MM-DD`.
 * @param intervals - Absolute busy intervals. Half-open `[start, end)`.
 * @param openSlots - Optional set of slots that *are* working hours. When
 *   provided, every other slot is marked busy (non-working hours folded in).
 *   When omitted, the whole day is assumed open and only `intervals` matter.
 */
export function buildBusyMask(
  clinic: ClinicDayGrid,
  date: string,
  intervals: readonly BusyInterval[],
  openSlots?: ReadonlySet<number>,
): bigint {
  const { start, end, totalSlots } = clinicDayWindow(clinic, date);
  let mask = 0n;

  if (openSlots !== undefined) {
    for (let slot = 0; slot < totalSlots; slot++) {
      if (!openSlots.has(slot)) {
        mask |= 1n << BigInt(slot);
      }
    }
  }

  for (const interval of intervals) {
    const from = DateTime.fromJSDate(interval.start, { zone: 'utc' }).setZone(
      clinic.timezone,
    );
    const to = DateTime.fromJSDate(interval.end, { zone: 'utc' }).setZone(
      clinic.timezone,
    );
    // Clip to the day. A booking that spans midnight is the caller's problem
    // to split; we only mark what falls on this date.
    const clippedStart = from < start ? start : from;
    const clippedEnd = to > end ? end : to;
    if (clippedEnd <= clippedStart) continue;

    const startMinutes = Math.max(
      0,
      Math.floor(
        clippedStart.diff(start, 'minutes').minutes / clinic.slotMinutes,
      ),
    );
    const endMinutes = Math.min(
      totalSlots,
      Math.ceil(clippedEnd.diff(start, 'minutes').minutes / clinic.slotMinutes),
    );
    for (let slot = startMinutes; slot < endMinutes; slot++) {
      mask |= 1n << BigInt(slot);
    }
  }

  return mask;
}

/**
 * Working-hours open slots for one resource on one date, after applying the
 * weekly roster and any date-specific exceptions.
 *
 * Exceptions that `available: false` remove slots; those that `available: true`
 * add slots outside the weekly roster (a rare overtime opening).
 */
export function openSlotsForResource(
  clinic: ClinicDayGrid,
  date: string,
  weekly: readonly { weekday: number; startsAt: string; endsAt: string }[],
  exceptions: readonly {
    startsAt: string;
    endsAt: string;
    available: boolean;
  }[],
): Set<number> {
  const { start, totalSlots } = clinicDayWindow(clinic, date);
  // Luxon: Mon=1..Sun=7. Schema / Postgres extract(dow) / JS getDay: Sun=0..Sat=6.
  // `weekday % 7` maps Sunday 7 → 0 and leaves Mon–Sat alone.
  const dow = start.weekday % 7;

  const open = new Set<number>();
  for (const window of weekly) {
    if (window.weekday !== dow) continue;
    paintSlots(clinic, date, window.startsAt, window.endsAt, (slot) => {
      open.add(slot);
    });
  }

  for (const exception of exceptions) {
    paintSlots(clinic, date, exception.startsAt, exception.endsAt, (slot) => {
      if (exception.available) open.add(slot);
      else open.delete(slot);
    });
  }

  // Defence: never claim a slot beyond the day.
  for (const slot of [...open]) {
    if (slot < 0 || slot >= totalSlots) open.delete(slot);
  }
  return open;
}

function paintSlots(
  clinic: ClinicDayGrid,
  date: string,
  startsAt: string,
  endsAt: string,
  paint: (slot: number) => void,
): void {
  const { start, end, totalSlots } = clinicDayWindow(clinic, date);
  const from = localOnDate(clinic, date, startsAt);
  const to = localOnDate(clinic, date, endsAt);
  const clippedStart = from < start ? start : from;
  const clippedEnd = to > end ? end : to;
  if (clippedEnd <= clippedStart) return;

  const first = Math.max(
    0,
    Math.floor(
      clippedStart.diff(start, 'minutes').minutes / clinic.slotMinutes,
    ),
  );
  const last = Math.min(
    totalSlots,
    Math.ceil(clippedEnd.diff(start, 'minutes').minutes / clinic.slotMinutes),
  );
  for (let slot = first; slot < last; slot++) paint(slot);
}

function localOnDate(
  clinic: ClinicDayGrid,
  date: string,
  wallClock: string,
): DateTime {
  const time = wallClock.length === 5 ? `${wallClock}:00` : wallClock;
  const local = DateTime.fromISO(`${date}T${time}`, { zone: clinic.timezone });
  if (!local.isValid) {
    throw new RangeError(
      `cannot parse ${date}T${time} in zone ${clinic.timezone}: ${String(local.invalidExplanation)}`,
    );
  }
  return local;
}
