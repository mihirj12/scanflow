import type { AuditEntry } from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId, type ReactElement } from 'react';

import { fetchAudit } from '../api/client';

import { ModalShell } from './ModalShell';

export interface AuditLogPanelProps {
  timeZone: string;
  onClose: () => void;
}

/** Read-only activity trail for administrators. */
export function AuditLogPanel({
  timeZone,
  onClose,
}: AuditLogPanelProps): ReactElement {
  const titleId = useId();
  const audit = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => fetchAudit(100),
  });

  return (
    <ModalShell
      active
      onClose={onClose}
      className="audit-log-panel"
      labelledBy={titleId}
    >
      <header className="audit-log-panel__header">
        <h2 id={titleId} className="audit-log-panel__title">
          Activity log
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <p className="audit-log-panel__hint">
        Recent actions by staff across the clinic. Patient identifiers are never
        recorded here.
      </p>

      {audit.isLoading ? (
        <p className="audit-log-panel__loading">Loading activity…</p>
      ) : null}

      {audit.isError ? (
        <p className="audit-log-panel__error" role="alert">
          Could not load the activity log. Confirm you are signed in as an
          administrator.
        </p>
      ) : null}

      {audit.data?.items.length === 0 ? (
        <p className="audit-log-panel__empty">No activity recorded yet.</p>
      ) : null}

      {audit.data !== undefined && audit.data.items.length > 0 ? (
        <div className="audit-log-panel__table-wrap">
          <table className="audit-log-panel__table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">User</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatWhen(entry.at, timeZone)}</td>
                  <td>{formatActor(entry)}</td>
                  <td>{formatAction(entry.action)}</td>
                  <td>{formatTarget(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </ModalShell>
  );
}

function formatWhen(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(at));
}

function formatActor(entry: AuditEntry): string {
  if (entry.actorEmail !== null && entry.actorEmail !== '') {
    return entry.actorEmail;
  }
  return 'System';
}

function formatAction(action: string): string {
  if (action.startsWith('APPOINTMENT_')) {
    const verb = action.slice('APPOINTMENT_'.length);
    return verb
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  }
  return action
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function formatTarget(entry: AuditEntry): string {
  const entity =
    entry.entity.charAt(0).toUpperCase() + entry.entity.slice(1).toLowerCase();
  if (entry.entityId === null) return entity;
  return `${entity} ${entry.entityId.slice(0, 8)}…`;
}
