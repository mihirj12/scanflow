import type { ListAuditResponse } from '@scanflow/contracts';

import type { AuditReadRepository } from './ports.js';

/**
 * Read-only view of the trail, for ADMIN. Entries carry ids and actions only —
 * the audit log is read by more people than the appointment table is, so it must
 * never contain a patient identifier.
 */
export function createListAuditUseCase(deps: { audit: AuditReadRepository }) {
  return async function listAudit(query: {
    clinicId: string;
    entityId?: string;
    limit: number;
  }): Promise<ListAuditResponse> {
    const items = await deps.audit.list(query.clinicId, {
      ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      limit: query.limit,
    });
    return { items };
  };
}
