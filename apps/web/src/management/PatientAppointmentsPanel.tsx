import type { PatientDto } from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId, type ReactElement } from 'react';

import { listAppointments } from '../api/client';

import { FocusTrap } from './FocusTrap';

export interface PatientAppointmentsPanelProps {
  patient: PatientDto;
  onClose: () => void;
  onSelectAppointment: (appointmentId: string) => void;
}

/**
 * Opened from search when a receptionist picks a patient — lists their visits
 * instead of jumping straight into the booking wizard.
 */
export function PatientAppointmentsPanel({
  patient,
  onClose,
  onSelectAppointment,
}: PatientAppointmentsPanelProps): ReactElement {
  const titleId = useId();
  const appointments = useQuery({
    queryKey: ['patient-appointments', patient.id],
    queryFn: () => listAppointments({ patientId: patient.id, limit: 50 }),
  });

  return (
    <FocusTrap
      active
      onEscape={onClose}
      className="patient-appointments"
      labelledBy={titleId}
    >
      <header className="patient-appointments__header">
        <h2 id={titleId} className="patient-appointments__title">
          {patient.fullName}
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <p className="patient-appointments__meta">{patient.mrn}</p>

      {appointments.isLoading ? (
        <p className="patient-appointments__loading">Loading appointments…</p>
      ) : appointments.isError ? (
        <p className="field__error" role="alert">
          Could not load appointments for this patient.
        </p>
      ) : (appointments.data?.items.length ?? 0) === 0 ? (
        <p className="patient-appointments__empty">
          No appointments on record for this patient.
        </p>
      ) : (
        <ul className="patient-appointments__list">
          {appointments.data?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="patient-appointments__row"
                onClick={() => {
                  onSelectAppointment(item.id);
                }}
              >
                <span>
                  {item.templateNameAtBooking ?? 'Appointment'} · {item.onDate}
                </span>
                <span className="patient-appointments__status">
                  {item.status.replaceAll('_', ' ').toLowerCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </FocusTrap>
  );
}
