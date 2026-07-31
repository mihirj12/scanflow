import type {
  AppointmentDetail,
  AppointmentStatus,
  PatientDto,
} from '@scanflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useState, type ReactElement } from 'react';

import {
  fetchAppointment,
  fetchPatient,
  fetchServiceTypes,
  postAppointmentStatus,
  type StatusActionPath,
} from '../api/client';

import { FocusTrap } from './FocusTrap';
import {
  drawerStatusActions,
  kebabActionsFor,
  statusActionPath,
  type KebabAction,
} from './status-actions';

export interface AppointmentDrawerProps {
  appointmentId: string | null;
  timeZone: string;
  onClose: () => void;
  onReschedule: (detail: AppointmentDetail, patient: PatientDto) => void;
  onPrint: (detail: AppointmentDetail, patient: PatientDto) => void;
}

/**
 * A drawer rather than a dropdown: the grid stays visible as context while the
 * receptionist reads the full chain (spec 8).
 */
export function AppointmentDrawer({
  appointmentId,
  ...rest
}: AppointmentDrawerProps): ReactElement | null {
  if (appointmentId === null) return null;
  // Remount per appointment so per-appointment local state cannot leak across.
  return (
    <DrawerBody key={appointmentId} appointmentId={appointmentId} {...rest} />
  );
}

function DrawerBody({
  appointmentId,
  timeZone,
  onClose,
  onReschedule,
  onPrint,
}: Omit<AppointmentDrawerProps, 'appointmentId'> & {
  appointmentId: string;
}): ReactElement {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => fetchAppointment(appointmentId),
  });

  const detail = detailQuery.data;
  const patientId = detail?.patientId;

  const patientQuery = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => fetchPatient(patientId ?? ''),
    enabled: patientId !== undefined,
  });

  const serviceTypesQuery = useQuery({
    queryKey: ['service-types'],
    queryFn: fetchServiceTypes,
  });

  const handleEscape = useCallback(() => {
    onClose();
  }, [onClose]);

  const patient = patientQuery.data;
  const status = detail?.status;
  const serviceTypeName = new Map<string, string>();
  for (const service of serviceTypesQuery.data?.items ?? []) {
    serviceTypeName.set(service.id, service.name);
  }
  const stepLabel = new Map<number, string>();
  for (const step of detail?.steps ?? []) {
    stepLabel.set(step.seq, serviceTypeName.get(step.serviceTypeId) ?? 'Step');
  }

  async function runStatus(
    path: StatusActionPath,
    reason?: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await postAppointmentStatus(appointmentId, path, {
        ...(reason === undefined || reason === '' ? {} : { reason }),
      });
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      await queryClient.invalidateQueries({
        queryKey: ['appointment', appointmentId],
      });
      setConfirmCancel(false);
      setCancelReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  function onAction(action: KebabAction): void {
    if (action.id === 'cancel') {
      setConfirmCancel(true);
      return;
    }
    if (detail !== undefined && patient !== undefined) {
      if (action.id === 'reschedule') {
        onReschedule(detail, patient);
        return;
      }
      if (action.id === 'print') {
        onPrint(detail, patient);
        return;
      }
    }
    if (action.toStatus !== undefined) {
      const path = statusActionPath(action.toStatus);
      if (path !== null) void runStatus(path);
    }
  }

  const actions =
    status === undefined
      ? []
      : [...kebabActionsFor(status), ...drawerStatusActions(status)].filter(
          (action, index, all) =>
            all.findIndex((a) => a.id === action.id) === index,
        );

  return (
    <FocusTrap
      active
      onEscape={handleEscape}
      className="appointment-drawer"
      labelledBy={titleId}
    >
      <header className="appointment-drawer__header">
        <h2 id={titleId} className="appointment-drawer__title">
          Appointment
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      {detailQuery.isLoading || patientQuery.isLoading ? (
        <p className="appointment-drawer__loading">Loading…</p>
      ) : detail === undefined || patient === undefined ? (
        <p className="field__error" role="alert">
          Could not load this appointment. Close the drawer and try again.
        </p>
      ) : (
        <div className="appointment-drawer__body">
          <section className="appointment-drawer__section">
            <h3>Patient</h3>
            <p>{patient.fullName}</p>
            <p className="appointment-drawer__muted">{patient.mrn}</p>
            {patient.phone !== null ? (
              <p className="appointment-drawer__muted">{patient.phone}</p>
            ) : null}
          </section>

          <section className="appointment-drawer__section">
            <h3>Status</h3>
            <p>{formatStatus(detail.status)}</p>
            <p className="appointment-drawer__muted">
              Updated {formatInstant(detail.updatedAt, timeZone)}
            </p>
          </section>

          <section className="appointment-drawer__section">
            <h3>Segments</h3>
            <ul className="appointment-drawer__segments">
              {detail.segments.map((segment) => (
                <li key={segment.id}>
                  <span>
                    {segment.kind === 'DELAY'
                      ? `Wait (before step ${String(segment.seq)})`
                      : (stepLabel.get(segment.seq) ??
                        `Step ${String(segment.seq)}`)}
                  </span>
                  <span className="appointment-drawer__muted">
                    {formatInstant(segment.patientStart, timeZone)}–
                    {formatInstant(segment.patientEnd, timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {detail.notes !== null && detail.notes !== '' ? (
            <section className="appointment-drawer__section">
              <h3>Notes</h3>
              <p>{detail.notes}</p>
            </section>
          ) : null}

          {confirmCancel ? (
            <section className="appointment-drawer__section">
              <h3>Cancel appointment</h3>
              <label className="field">
                <span className="field__label">Reason (optional)</span>
                <textarea
                  value={cancelReason}
                  onChange={(event) => {
                    setCancelReason(event.target.value);
                  }}
                  rows={3}
                  maxLength={500}
                />
              </label>
              <div className="wizard__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setConfirmCancel(false);
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => {
                    void runStatus('cancel', cancelReason);
                  }}
                >
                  {busy ? 'Cancelling…' : 'Cancel appointment'}
                </button>
              </div>
            </section>
          ) : (
            <section className="appointment-drawer__section">
              <h3>Actions</h3>
              <div className="appointment-drawer__actions">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => {
                      onAction(action);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {error !== null ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </FocusTrap>
  );
}

function formatStatus(status: AppointmentStatus): string {
  const words = status.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}
