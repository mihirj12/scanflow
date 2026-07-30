import type { NextFunction, Request, Response } from 'express';
import { type z } from 'zod';

import { ValidationFailedError } from '../../errors/domain-errors.js';

type RequestSlot = 'body' | 'query' | 'params';

/**
 * Zod → 400 problem. Controllers stay free of validation logic; they receive
 * already-parsed values on `req.body` / `req.query` / `req.params`.
 *
 * Express 5 exposes `query` (and sometimes `params`) as getters derived from the
 * URL. A plain assignment throws, which surfaces as a 500 — so we redefine the
 * property with the parsed value instead.
 */
export function validate<T>(schema: z.ZodType<T>, slot: RequestSlot = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[slot]);
    if (!parsed.success) {
      next(
        new ValidationFailedError(
          parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        ),
      );
      return;
    }

    Object.defineProperty(req, slot, {
      value: parsed.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
