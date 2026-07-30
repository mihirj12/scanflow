import { hash, verify } from '@node-rs/argon2';

import { ARGON2ID, type PasswordHasher } from '../../modules/auth/ports.js';

/**
 * argon2id with the library defaults (m=19456 KiB, t=2, p=1), which match the
 * OWASP minimum. Deliberately not configurable by environment: a deployment that
 * can lower the cost parameters is a deployment that will.
 */
const OPTIONS = { algorithm: ARGON2ID } as const;

/**
 * Adapter for {@link PasswordHasher}. The decoy is hashed once at construction
 * so the equal-cost failure path in login does not need a database row.
 */
export async function createArgon2Hasher(): Promise<PasswordHasher> {
  const decoyHash = await hash(
    `decoy-${Math.random().toString(36).slice(2)}`,
    OPTIONS,
  );

  return {
    decoyHash,
    hash: (plain) => hash(plain, OPTIONS),
    async verify(stored, plain) {
      try {
        return await verify(stored, plain, OPTIONS);
      } catch {
        // A malformed stored hash must read as "wrong password", not as a 500.
        return false;
      }
    },
  };
}
