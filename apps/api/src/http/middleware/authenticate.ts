import type { UserRole } from '@scanflow/contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  ForbiddenError,
  UnauthenticatedError,
} from '../../errors/domain-errors.js';
import type { AccessTokenIssuer } from '../../modules/auth/ports.js';

export interface AuthenticatedActor {
  userId: string;
  clinicId: string;
  email: string;
  role: UserRole;
}

/**
 * `req.auth` is the only channel between the guard and a controller. Declaring it
 * on Express's own interface keeps controllers from casting.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the shape Express's own types use
  namespace Express {
    interface Request {
      auth?: AuthenticatedActor;
    }
  }
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined) return null;
  return value.trim() === '' ? null : value.trim();
}

/**
 * Rejects anything without a valid access token. Mounted on the whole `/api/v1`
 * router after the two probe routes, so "authenticated by default" is the
 * structure rather than a decision each route makes.
 */
export function authenticate(deps: {
  accessTokens: AccessTokenIssuer;
  clinicId: string;
}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void (async () => {
      const token = bearerToken(req.headers.authorization);
      if (token === null) {
        next(new UnauthenticatedError());
        return;
      }

      const claims = await deps.accessTokens.verify(token);
      if (claims?.clinicId !== deps.clinicId) {
        next(
          new UnauthenticatedError(
            'That access token is not valid. Refresh the session and try again.',
          ),
        );
        return;
      }

      req.auth = claims;
      next();
    })();
  };
}

/** Role check by membership, not rank: a clinician is not a lesser admin. */
export function requireRole(...roles: readonly UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.auth;
    if (actor === undefined) {
      next(new UnauthenticatedError());
      return;
    }
    if (!roles.includes(actor.role)) {
      next(new ForbiddenError(roles));
      return;
    }
    next();
  };
}
