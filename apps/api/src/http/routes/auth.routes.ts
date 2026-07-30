import { type LoginBody, loginBodySchema } from '@scanflow/contracts';
import { type CookieOptions, Router, type Request } from 'express';

import type { AppContainer } from '../../container.js';
import { UnauthenticatedError } from '../../errors/domain-errors.js';
import type { IssuedSession } from '../../modules/auth/session.usecase.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

/**
 * The refresh cookie. httpOnly so page scripts cannot read it, SameSite=Strict
 * so it is not sent on cross-site navigations, and path-scoped to the auth
 * routes so it never rides along on ordinary API calls (spec 9).
 */
export const REFRESH_COOKIE = 'scanflow_refresh';
const COOKIE_PATH = '/api/v1/auth';

function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    // Browsers treat localhost as a secure context, so this holds in dev too.
    secure: true,
    path: COOKIE_PATH,
    maxAge: maxAgeSeconds * 1000,
  };
}

export function buildAuthRouter(container: AppContainer): Router {
  const auth = Router();
  const clinicId = container.config.CLINIC_ID;

  const respond = (
    res: Parameters<Parameters<typeof auth.post>[1]>[1],
    session: IssuedSession,
  ): void => {
    res
      .cookie(
        REFRESH_COOKIE,
        session.refreshToken,
        cookieOptions(session.refreshTtlSeconds),
      )
      .json({
        accessToken: session.accessToken,
        expiresInSeconds: session.expiresInSeconds,
        user: session.user,
      });
  };

  auth.post('/login', validate(loginBodySchema), async (req, res, next) => {
    try {
      const body = req.body as LoginBody;
      const session = await container.useCases.login({
        clinicId,
        email: body.email,
        password: body.password,
      });
      respond(res, session);
    } catch (error) {
      next(error);
    }
  });

  auth.post('/refresh', async (req, res, next) => {
    try {
      const presented = refreshCookieOf(req);
      if (presented === null) {
        throw new UnauthenticatedError('No session cookie. Sign in again.');
      }
      const session = await container.useCases.refreshSession({
        clinicId,
        refreshToken: presented,
      });
      respond(res, session);
    } catch (error) {
      next(error);
    }
  });

  auth.post('/logout', async (req, res, next) => {
    try {
      const presented = refreshCookieOf(req);
      if (presented !== null) {
        await container.useCases.logout({ refreshToken: presented });
      }
      res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH }).status(204).end();
    } catch (error) {
      next(error);
    }
  });

  auth.get(
    '/me',
    authenticate({
      accessTokens: container.auth.accessTokens,
      clinicId,
    }),
    async (req, res, next) => {
      try {
        const actor = req.auth;
        if (actor === undefined) throw new UnauthenticatedError();
        res.json(
          await container.useCases.getCurrentUser({
            clinicId,
            userId: actor.userId,
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return auth;
}

function refreshCookieOf(req: Request): string | null {
  const raw = req.cookies as Record<string, unknown>;
  const presented = raw[REFRESH_COOKIE];
  return typeof presented === 'string' && presented !== '' ? presented : null;
}
