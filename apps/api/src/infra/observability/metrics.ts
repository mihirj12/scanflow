import type { BookingMetrics } from '../../modules/appointments/ports.js';
import type { SuggestionMetrics } from '../../modules/scheduling/ports.js';

export interface MetricsSnapshot {
  suggestion: {
    count: number;
    /** Mean and p95 of engine compute time, in milliseconds. */
    meanMs: number;
    p95Ms: number;
    maxMs: number;
  };
  booking: {
    attempts: number;
    conflicts: number;
    /** Conflicts as a share of attempts. The number to watch under load. */
    conflictRate: number;
  };
}

export interface MetricsRegistry extends SuggestionMetrics, BookingMetrics {
  snapshot(): MetricsSnapshot;
}

/**
 * Three domain metrics, in memory (spec 9).
 *
 * Deliberately not Prometheus: a counter object is enough to answer "is the
 * engine slow" and "are we fighting over slots", and it costs no dependency and
 * no scrape endpoint to secure. The shape is the same one an exporter would read,
 * so swapping this for prom-client later touches only this file and the route.
 *
 * A ring buffer of the last 512 durations bounds memory and still gives a
 * meaningful p95 — this is a clinic, not a fleet.
 */
const WINDOW = 512;

export function createMetricsRegistry(): MetricsRegistry {
  const durations: number[] = [];
  let writeIndex = 0;
  let suggestionCount = 0;
  let attempts = 0;
  let conflicts = 0;

  return {
    suggestionComputed(ms) {
      suggestionCount += 1;
      if (durations.length < WINDOW) {
        durations.push(ms);
      } else {
        durations[writeIndex] = ms;
        writeIndex = (writeIndex + 1) % WINDOW;
      }
    },

    bookingAttempted() {
      attempts += 1;
    },

    bookingConflicted() {
      conflicts += 1;
    },

    snapshot() {
      const sorted = [...durations].sort((a, b) => a - b);
      const total = sorted.reduce((sum, value) => sum + value, 0);
      const p95Index =
        sorted.length === 0
          ? 0
          : Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
      return {
        suggestion: {
          count: suggestionCount,
          meanMs: sorted.length === 0 ? 0 : round(total / sorted.length),
          p95Ms: round(sorted[p95Index] ?? 0),
          maxMs: round(sorted[sorted.length - 1] ?? 0),
        },
        booking: {
          attempts,
          conflicts,
          conflictRate: attempts === 0 ? 0 : round(conflicts / attempts, 4),
        },
      };
    },
  };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
