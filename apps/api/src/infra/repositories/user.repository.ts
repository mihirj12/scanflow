import { and, eq, isNull } from 'drizzle-orm';

import type {
  AuthUser,
  RefreshTokenRepository,
  StoredRefreshToken,
  UserRepository,
} from '../../modules/auth/ports.js';
import type { Db } from '../db/client.js';
import { appUser, refreshToken } from '../db/schema.js';

function toAuthUser(row: typeof appUser.$inferSelect): AuthUser {
  return {
    id: row.id,
    clinicId: row.clinicId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    passwordHash: row.passwordHash,
    active: row.active,
  };
}

export function createUserRepository(db: Db): UserRepository {
  return {
    async findByEmail(clinicId, email) {
      const rows = await db
        .select()
        .from(appUser)
        .where(and(eq(appUser.clinicId, clinicId), eq(appUser.email, email)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toAuthUser(row);
    },

    async findById(clinicId, id) {
      const rows = await db
        .select()
        .from(appUser)
        .where(and(eq(appUser.clinicId, clinicId), eq(appUser.id, id)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toAuthUser(row);
    },
  };
}

export function createRefreshTokenRepository(db: Db): RefreshTokenRepository {
  return {
    async insert(row) {
      await db.insert(refreshToken).values({
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
      });
    },

    async findByHash(tokenHash): Promise<StoredRefreshToken | null> {
      const rows = await db
        .select()
        .from(refreshToken)
        .where(eq(refreshToken.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        userId: row.userId,
        familyId: row.familyId,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        revokedAt: row.revokedAt,
      };
    },

    async markUsed(id, at) {
      await db
        .update(refreshToken)
        .set({ usedAt: at })
        .where(eq(refreshToken.id, id));
    },

    async revokeFamily(familyId, at) {
      await db
        .update(refreshToken)
        .set({ revokedAt: at })
        .where(
          and(
            eq(refreshToken.familyId, familyId),
            isNull(refreshToken.revokedAt),
          ),
        );
    },
  };
}
