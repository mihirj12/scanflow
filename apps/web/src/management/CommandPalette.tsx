import type { PatientDto } from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';

import { listAppointments, searchPatients } from '../api/client';

export interface CommandPaletteProps {
  onClose: () => void;
  onSelectAppointment: (appointmentId: string) => void;
  onSelectPatient: (patient: PatientDto) => void;
}

type PaletteRow =
  | {
      key: string;
      kind: 'appointment';
      id: string;
      label: string;
      meta: string;
    }
  | {
      key: string;
      kind: 'patient';
      label: string;
      meta: string;
      patient: PatientDto;
    };

/**
 * What a receptionist on a phone call reaches for. Mounted only while open (the
 * parent remounts it) so the query resets without an effect.
 */
export function CommandPalette({
  onClose,
  onSelectAppointment,
  onSelectPatient,
}: CommandPaletteProps): ReactElement {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const patients = useQuery({
    queryKey: ['palette-patients', query],
    queryFn: () => searchPatients(query, 8),
  });
  const appointments = useQuery({
    queryKey: ['palette-appointments', query],
    queryFn: () => listAppointments({ q: query, limit: 8 }),
  });

  const rows: PaletteRow[] = [
    ...(patients.data?.items ?? []).map((patient) => ({
      key: `patient-${patient.id}`,
      kind: 'patient' as const,
      label: patient.fullName,
      meta: patient.mrn,
      patient,
    })),
    ...(appointments.data?.items ?? []).map((item) => ({
      key: `appointment-${item.id}`,
      kind: 'appointment' as const,
      id: item.id,
      label: item.templateNameAtBooking ?? 'Appointment',
      meta: `${item.onDate} · ${item.status.replaceAll('_', ' ').toLowerCase()}`,
    })),
  ];

  const activeRowIndex =
    rows.length === 0 ? 0 : Math.min(activeIndex, rows.length - 1);

  function activate(row: PaletteRow): void {
    if (row.kind === 'appointment') {
      onSelectAppointment(row.id);
    } else {
      onSelectPatient(row.patient);
    }
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(rows.length - 1, activeRowIndex + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(0, activeRowIndex - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeRowIndex];
      if (row !== undefined) activate(row);
    }
  }

  return (
    <div className="command-palette" role="presentation">
      <button
        type="button"
        className="command-palette__backdrop"
        aria-label="Close search"
        onClick={onClose}
      />
      <div
        className="command-palette__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="visually-hidden">
          Search patients and appointments
        </h2>
        <input
          className="command-palette__input"
          type="search"
          value={query}
          autoFocus
          placeholder="Search by name, MRN, or phone"
          aria-label="Search by name, MRN, or phone"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          className="command-palette__list"
          role="listbox"
          aria-label="Results"
        >
          {rows.length === 0 ? (
            <li className="command-palette__empty">
              No matches. Try a surname, an MRN, or the last digits of a phone
              number.
            </li>
          ) : (
            rows.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeRowIndex}
                  className={[
                    'command-palette__row',
                    index === activeRowIndex
                      ? 'command-palette__row--active'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    activate(row);
                  }}
                >
                  <span>{row.label}</span>
                  <span className="command-palette__meta">{row.meta}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
