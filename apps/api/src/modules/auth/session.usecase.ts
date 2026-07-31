import { randomUUID } from 'node:crypto';

import type { CurrentUser } from '@scanflow/contracts';

import {
  InvalidCredentialsError,
  UnauthenticatedError,
} from '../../errors/domain-errors.js';

import type {
  AccessTokenIssuer,
  AuthUser,
  Clock,
  PasswordHasher,
  RefreshTokenCodec,
  RefreshTokenRepository,
  UserRepository,
} from './ports.js';

export interface SessionDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  accessTokens: AccessTokenIssuer;
  refreshCodec: RefreshTokenCodec;
  clock: Clock;
  refreshTtlSeconds: number;
}

export interface IssuedSession {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshTtlSeconds: number;
  user: CurrentUser;
}

function toCurrentUser(user: AuthUser): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    resourceId: user.resourceId,
  };
}

/**
 * Issues an access token plus a refresh token in a new family. `familyId` is the
 * login; every rotation stays inside it so a replay can revoke the whole chain.
 */
async function issue(
  deps: SessionDeps,
  user: AuthUser,
  familyId: string,
): Promise<IssuedSession> {
  const { token, hash } = deps.refreshCodec.create();
  const expiresAt = new Date(
    deps.clock.now().getTime() + deps.refreshTtlSeconds * 1000,
  );
  await deps.refreshTokens.insert({
    userId: user.id,
    familyId,
    tokenHash: hash,
    expiresAt,
  });
  const accessToken = await deps.accessTokens.issue({
    userId: user.id,
    clinicId: user.clinicId,
    email: user.email,
    role: user.role,
    resourceId: user.resourceId,
  });
  return {
    accessToken,
    expiresInSeconds: deps.accessTokens.ttlSeconds,
    refreshToken: token,
    refreshTtlSeconds: deps.refreshTtlSeconds,
    user: toCurrentUser(user),
  };
}

export function createLoginUseCase(deps: SessionDeps) {
  return async function login(cmd: {
    clinicId: string;
    email: string;
    password: string;
  }): Promise<IssuedSession> {
    const email = cmd.email.trim().toLowerCase();
    const user = await deps.users.findByEmail(cmd.clinicId, email);

    // Always run one verification, even with no such user, so the two failure
    // paths cost the same. See PasswordHasher.decoyHash.
    const ok = await deps.hasher.verify(
      user?.passwordHash ?? deps.hasher.decoyHash,
      cmd.password,
    );
    if (user === null || !ok || !user.active) {
      throw new InvalidCredentialsError();
    }

    return issue(deps, user, randomUUID());
  };
}

export function createRefreshSessionUseCase(deps: SessionDeps) {
  return async function refreshSession(cmd: {
    clinicId: string;
    refreshToken: string;
  }): Promise<IssuedSession> {
    const hash = deps.refreshCodec.hashOf(cmd.refreshToken);
    const stored = await deps.refreshTokens.findByHash(hash);
    if (stored === null) {
      throw new UnauthenticatedError(
        'That session is no longer valid. Sign in again.',
      );
    }

    const now = deps.clock.now();

    // Reuse detection: a rotated or revoked token being presented again means
    // someone kept a copy. Kill the family; the legitimate user re-authenticates.
    if (stored.usedAt !== null || stored.revokedAt !== null) {
      await deps.refreshTokens.revokeFamily(stored.familyId, now);
      throw new UnauthenticatedError(
        'That session was ended for safety because a refresh token was reused. Sign in again.',
      );
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthenticatedError('That session expired. Sign in again.');
    }

    const user = await deps.users.findById(cmd.clinicId, stored.userId);
    if (user?.active !== true) {
      await deps.refreshTokens.revokeFamily(stored.familyId, now);
      throw new UnauthenticatedError(
        'That account can no longer sign in. Contact an administrator.',
      );
    }

    await deps.refreshTokens.markUsed(stored.id, now);
    return issue(deps, user, stored.familyId);
  };
}

export function createLogoutUseCase(deps: SessionDeps) {
  /** Idempotent: an unknown or already-revoked token still resolves. */
  return async function logout(cmd: { refreshToken: string }): Promise<void> {
    const stored = await deps.refreshTokens.findByHash(
      deps.refreshCodec.hashOf(cmd.refreshToken),
    );
    if (stored === null) return;
    await deps.refreshTokens.revokeFamily(stored.familyId, deps.clock.now());
  };
}
