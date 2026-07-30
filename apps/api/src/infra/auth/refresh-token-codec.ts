import { createHash, randomBytes } from 'node:crypto';

import type { RefreshTokenCodec } from '../../modules/auth/ports.js';

/**
 * 256 bits of randomness, stored only as a SHA-256 digest.
 *
 * A plain digest is right here where argon2id would be wrong: the token is
 * already high-entropy random, so there is nothing to brute-force, and refresh
 * happens on a hot path that must not cost 50ms of hashing.
 */
export function createRefreshTokenCodec(): RefreshTokenCodec {
  const hashOf = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

  return {
    hashOf,
    create() {
      const token = randomBytes(32).toString('base64url');
      return { token, hash: hashOf(token) };
    },
  };
}
