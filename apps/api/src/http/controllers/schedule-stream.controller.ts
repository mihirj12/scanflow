import type { Request, Response } from 'express';

import type { ScheduleEventBus } from '../../infra/events/schedule-events.js';

/**
 * Server-sent events for one clinic-day.
 *
 * Held open, so the usual JSON serialisation does not apply: this writes the
 * `text/event-stream` framing itself. A comment line every 25 seconds keeps
 * proxies from reaping an idle connection; the browser's own reconnect handles
 * the rest, and the grid's 60-second poll covers a stream that never comes back.
 */
const HEARTBEAT_MS = 25_000;

export function streamSchedule(deps: {
  events: ScheduleEventBus;
  clinicId: string;
}) {
  return (req: Request, res: Response): void => {
    const date = typeof req.query['date'] === 'string' ? req.query['date'] : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).type('application/problem+json').json({
        type: 'https://scanflow.local/problems/validation-failed',
        title: 'Validation failed',
        status: 400,
        detail: 'Provide date as YYYY-MM-DD.',
      });
      return;
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Belt and braces for reverse proxies that buffer by default.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const unsubscribe = deps.events.subscribe(
      { clinicId: deps.clinicId, date },
      (event) => {
        res.write(
          `event: schedule-changed\ndata: ${JSON.stringify({
            date: event.date,
            version: event.version,
          })}\n\n`,
        );
      },
    );

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  };
}
