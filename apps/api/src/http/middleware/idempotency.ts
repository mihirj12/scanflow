import { createHash } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { IdempotencyConflictError } from '../../errors/domain-errors.js';
import type { IdempotencyRepository } from '../../modules/appointments/ports.js';

/**
 * Replay protection for mutating endpoints.
 *
 * On a cache hit with the same body hash, the original status and JSON are
 * returned and `res.locals.idempotentReplay` is set so the route handler can
 * skip work. On a hash mismatch, 409. On a miss, the handler runs and must call
 * `res.locals.saveIdempotency(status, body)` before responding.
 */
export function idempotency(deps: {
  clinicId: string;
  records: IdempotencyRepository;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const keyHeader = req.header('Idempotency-Key');
    if (keyHeader === undefined || keyHeader.trim() === '') {
      next();
      return;
    }
    const key = keyHeader.trim();
    const requestHash = hashRequest(req.method, req.path, req.body);

    try {
      const existing = await deps.records.find(deps.clinicId, key);
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          next(new IdempotencyConflictError());
          return;
        }
        res.locals['idempotentReplay'] = true;
        res.status(existing.statusCode).json(existing.response);
        return;
      }

      res.locals['saveIdempotency'] = async (
        statusCode: number,
        body: unknown,
      ) => {
        await deps.records.save({
          clinicId: deps.clinicId,
          key,
          requestHash,
          method: req.method,
          path: req.path,
          statusCode,
          response: body,
        });
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function hashRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(method)
    .update('\n')
    .update(path)
    .update('\n')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}
