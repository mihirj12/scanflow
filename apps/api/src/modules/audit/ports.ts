import type { AuditEntry } from '@scanflow/contracts';

export interface AuditReadRepository {
  list(
    clinicId: string,
    filter: { entityId?: string; limit: number },
  ): Promise<AuditEntry[]>;
}
