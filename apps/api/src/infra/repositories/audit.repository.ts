import type { AuditEntry } from '@scanflow/contracts';
import { and, desc, eq } from 'drizzle-orm';

import type { AuditReadRepository } from '../../modules/audit/ports.js';
import type { Db } from '../db/client.js';
import { appUser, auditLog } from '../db/schema.js';

export function createAuditReadRepository(db: Db): AuditReadRepository {
  return {
    async list(clinicId, filter) {
      const where =
        filter.entityId === undefined
          ? eq(auditLog.clinicId, clinicId)
          : and(
              eq(auditLog.clinicId, clinicId),
              eq(auditLog.entityId, filter.entityId),
            );

      const rows = await db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          actorId: auditLog.actorId,
          // Left join: system-initiated rows have no actor, and a deleted user
          // must not make its history unreadable.
          actorEmail: appUser.email,
          at: auditLog.at,
        })
        .from(auditLog)
        .leftJoin(appUser, eq(appUser.id, auditLog.actorId))
        .where(where)
        .orderBy(desc(auditLog.id))
        .limit(filter.limit);

      return rows.map((row): AuditEntry => ({
        id: row.id,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        at: row.at.toISOString(),
      }));
    },
  };
}
