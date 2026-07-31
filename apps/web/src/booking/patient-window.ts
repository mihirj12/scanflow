import type { AvailabilityWindow } from '@scanflow/contracts';

function normalizeClock(value: string): string {
  return value.length === 5 ? value : value.slice(0, 5);
}

/** Builds the suggest payload field when the toggle is on. */
export function patientWindowPayload(
  enabled: boolean,
  windowStart: string,
  windowEnd: string,
): { patientWindow: AvailabilityWindow } | Record<string, never> {
  if (!enabled) return {};
  return {
    patientWindow: {
      startsAt: normalizeClock(windowStart),
      endsAt: normalizeClock(windowEnd),
    },
  };
}

export function formatPatientWindowLabel(
  windowStart: string,
  windowEnd: string,
): string {
  return `${normalizeClock(windowStart)}–${normalizeClock(windowEnd)}`;
}

export function patientWindowIsInvalid(
  enabled: boolean,
  windowStart: string,
  windowEnd: string,
): boolean {
  return enabled && normalizeClock(windowStart) >= normalizeClock(windowEnd);
}
