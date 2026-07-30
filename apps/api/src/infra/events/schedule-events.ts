import { EventEmitter } from 'node:events';

import { Redis } from 'ioredis';
import type { Logger } from 'pino';

/**
 * Fan-out for "this clinic-day changed".
 *
 * Every API instance publishes to one Redis channel and every instance forwards
 * what it receives to its own SSE clients, so a booking made on instance A
 * reaches a grid held open against instance B. Without a Redis URL the bus stays
 * in-process: correct for a single instance, and the UI's 60-second poll is the
 * safety net either way.
 */
const CHANNEL = 'scanflow:schedule-changed';

export interface ScheduleChangedEvent {
  clinicId: string;
  date: string;
  version: number;
}

export interface ScheduleEventBus {
  publish(event: ScheduleChangedEvent): Promise<void>;
  /** Returns an unsubscribe function. Never throws. */
  subscribe(
    filter: { clinicId: string; date: string },
    listener: (event: ScheduleChangedEvent) => void,
  ): () => void;
  close(): Promise<void>;
}

function isScheduleChanged(value: unknown): value is ScheduleChangedEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['clinicId'] === 'string' &&
    typeof candidate['date'] === 'string' &&
    typeof candidate['version'] === 'number'
  );
}

export function createScheduleEventBus(args: {
  redisUrl?: string | undefined;
  log: Logger;
}): ScheduleEventBus {
  const local = new EventEmitter();
  // One grid per browser tab, and a hospital has a lot of tabs.
  local.setMaxListeners(0);

  const emitLocal = (event: ScheduleChangedEvent): void => {
    local.emit(`${event.clinicId}:${event.date}`, event);
  };

  if (args.redisUrl === undefined) {
    return {
      publish(event) {
        emitLocal(event);
        return Promise.resolve();
      },
      subscribe(filter, listener) {
        const key = `${filter.clinicId}:${filter.date}`;
        local.on(key, listener);
        return () => {
          local.off(key, listener);
        };
      },
      close() {
        local.removeAllListeners();
        return Promise.resolve();
      },
    };
  }

  // Two connections: a client in subscribe mode cannot issue PUBLISH.
  const publisher = new Redis(args.redisUrl, { lazyConnect: true });
  const subscriber = new Redis(args.redisUrl, { lazyConnect: true });

  const started = (async () => {
    await publisher.connect();
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL);
    subscriber.on('message', (_channel: string, payload: string) => {
      try {
        const parsed: unknown = JSON.parse(payload);
        if (isScheduleChanged(parsed)) emitLocal(parsed);
      } catch {
        args.log.warn('discarded a malformed schedule event');
      }
    });
  })().catch((error: unknown) => {
    // A dead Redis must not take the API down; polling still refreshes grids.
    args.log.error({ err: error }, 'schedule event bus unavailable');
  });

  return {
    async publish(event) {
      await started;
      try {
        await publisher.publish(CHANNEL, JSON.stringify(event));
      } catch (error) {
        args.log.warn({ err: error }, 'schedule event publish failed');
        // Still notify this instance's own clients.
        emitLocal(event);
      }
    },

    subscribe(filter, listener) {
      const key = `${filter.clinicId}:${filter.date}`;
      local.on(key, listener);
      return () => {
        local.off(key, listener);
      };
    },

    async close() {
      local.removeAllListeners();
      publisher.disconnect();
      subscriber.disconnect();
      await Promise.resolve();
    },
  };
}
