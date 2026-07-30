import type { NextFunction, Request, Response } from 'express';
import { type z } from 'zod';

import { ValidationFailedError } from '../../errors/domain-errors.js';

type RequestSlot = 'body' | 'query' | 'params';

/**
 * Zod → 400 problem. Controllers stay free of validation logic; they receive
 * already-parsed values on `req.body` / `req.query` / `req.params`.
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
    (req as Request & Record<RequestSlot, T>)[slot] = parsed.data;
    next();
  };
}
