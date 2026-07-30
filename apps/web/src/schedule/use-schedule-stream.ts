import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAccessToken } from '../auth/access-token';

/**
 * Live schedule updates over SSE.
 *
 * Not `EventSource`, deliberately: it cannot send an Authorization header, and
 * the alternative — the access token in the query string — puts a credential in
 * proxy logs and browser history. `fetch` streams the same `text/event-stream`
 * and carries the bearer token like every other call.
 *
 * A dropped stream is not an error state. The grid keeps polling on its 60-second
 * safety net, and this reconnects with backoff.
 */
export function useScheduleStream(date: string, enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    async function connect(): Promise<void> {
      const token = getAccessToken();
      if (token === null) return;

      const response = await fetch(
        `/api/v1/schedule/stream?date=${encodeURIComponent(date)}`,
        {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          signal: controller.signal,
        },
      );
      if (!response.ok || response.body === null) {
        throw new Error(`stream refused (${String(response.status)})`);
      }

      attempt = 0;
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        // SSE frames are separated by a blank line.
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.includes('event: schedule-changed')) {
            void queryClient.invalidateQueries({
              queryKey: ['schedule', date],
            });
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    }

    function run(): void {
      connect().catch(() => {
        if (stopped) return;
        attempt += 1;
        // 1s, 2s, 4s … capped at 30s.
        const delay = Math.min(30_000, 1000 * 2 ** (attempt - 1));
        retryTimer = window.setTimeout(run, delay);
      });
    }

    run();

    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [date, enabled, queryClient]);
}
