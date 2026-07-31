import type { UserRole } from '@scanflow/contracts';

/**
 * Ports for the auth module. Declared next to the use cases that need them; the
 * argon2, jose, and Drizzle implementations live under `src/infra` (ADR 0004).
 */

export interface AuthUser {
  id: string;
  clinicId: string;
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
  resourceId: string | null;
}

export interface UserRepository {
  findByEmail(clinicId: string, email: string): Promise<AuthUser | null>;
  findById(clinicId: string, id: string): Promise<AuthUser | null>;
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

export interface RefreshTokenRepository {
  insert(row: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;
  markUsed(id: string, at: Date): Promise<void>;
  /** Revokes every unrevoked token descended from one login. */
  revokeFamily(familyId: string, at: Date): Promise<void>;
}

/**
 * `Algorithm.Argon2id` from @node-rs/argon2 is an ambient const enum, which
 * `verbatimModuleSyntax` will not import. The value is part of the argon2 spec,
 * not of the binding, so pinning the literal here is safe.
 */
export const ARGON2ID = 2;

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  /**
   * A real argon2id hash of a value nobody knows. Verifying against it when the
   * email does not exist keeps the failed-login path the same cost as the
   * wrong-password path, so response time does not reveal which accounts exist.
   */
  readonly decoyHash: string;
}

export interface AccessTokenClaims {
  userId: string;
  clinicId: string;
  email: string;
  role: UserRole;
  resourceId: string | null;
}

export interface AccessTokenIssuer {
  issue(claims: AccessTokenClaims): Promise<string>;
  /** Returns null for any invalid, expired, or wrongly-signed token. */
  verify(token: string): Promise<AccessTokenClaims | null>;
  readonly ttlSeconds: number;
}

export interface RefreshTokenCodec {
  /** A fresh opaque token and the hash to store. The token is never persisted. */
  create(): { token: string; hash: string };
  hashOf(token: string): string;
}

export interface Clock {
  now(): Date;
}
