import { userRoleSchema } from '@scanflow/contracts';
import { jwtVerify, SignJWT } from 'jose';

import type {
  AccessTokenClaims,
  AccessTokenIssuer,
} from '../../modules/auth/ports.js';

const ISSUER = 'scanflow';
const AUDIENCE = 'scanflow-api';

/**
 * HS256, because one process signs and the same process verifies. Asymmetric
 * keys buy nothing until a second service needs to verify without being able to
 * mint — at which point this adapter is the only thing that changes.
 */
export function createJwtAccessTokenIssuer(args: {
  secret: string;
  ttlSeconds: number;
}): AccessTokenIssuer {
  const key = new TextEncoder().encode(args.secret);

  return {
    ttlSeconds: args.ttlSeconds,

    async issue(claims: AccessTokenClaims): Promise<string> {
      return new SignJWT({
        clinicId: claims.clinicId,
        email: claims.email,
        role: claims.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${String(args.ttlSeconds)}s`)
        .sign(key);
    },

    async verify(token: string): Promise<AccessTokenClaims | null> {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        const role = userRoleSchema.safeParse(payload['role']);
        if (
          typeof payload.sub !== 'string' ||
          typeof payload['clinicId'] !== 'string' ||
          typeof payload['email'] !== 'string' ||
          !role.success
        ) {
          return null;
        }
        return {
          userId: payload.sub,
          clinicId: payload['clinicId'],
          email: payload['email'],
          role: role.data,
        };
      } catch {
        // Expired, tampered, wrong audience — all the same to the caller.
        return null;
      }
    },
  };
}
