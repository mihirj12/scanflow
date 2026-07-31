import type { PatientDto } from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactElement, type SyntheticEvent } from 'react';

import { createPatient, searchPatients } from '../api/client';

export interface PatientPickerProps {
  selected: PatientDto | null;
  onSelect: (patient: PatientDto) => void;
}

export function PatientPicker({
  selected,
  onSelect,
}: PatientPickerProps): ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const patients = useQuery({
    queryKey: ['patients', query],
    queryFn: () => searchPatients(query),
    enabled: !showCreate,
  });

  return (
    <div className="patient-picker">
      <label className="field" htmlFor={searchId}>
        <span className="field__label">Search patients</span>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Name, MRN, or phone"
          autoComplete="off"
        />
      </label>

      {patients.isError ? (
        <p className="field__error" role="alert">
          Could not load patients. Check the API and try again.
        </p>
      ) : null}

      <ul className="patient-picker__list" role="listbox" aria-label="Patients">
        {(patients.data?.items ?? []).map((patient) => {
          const isSelected = selected?.id === patient.id;
          return (
            <li key={patient.id}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={[
                  'patient-picker__row',
                  isSelected ? 'patient-picker__row--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onSelect(patient);
                }}
              >
                <span className="patient-picker__name">{patient.fullName}</span>
                <span className="patient-picker__mrn">{patient.mrn}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected !== null ? (
        <p className="patient-picker__chosen" aria-live="polite">
          Selected: {selected.fullName} ({selected.mrn})
        </p>
      ) : (
        <p className="patient-picker__hint">Select a patient to continue.</p>
      )}

      {showCreate ? (
        <CreatePatientForm
          onCancel={() => {
            setShowCreate(false);
            setCreateError(null);
          }}
          creating={creating}
          error={createError}
          onSubmit={async (body) => {
            setCreating(true);
            setCreateError(null);
            try {
              const created = await createPatient(body);
              onSelect(created);
              setShowCreate(false);
              setQuery(created.fullName);
            } catch (error) {
              setCreateError(
                error instanceof Error
                  ? error.message
                  : 'Could not create patient.',
              );
            } finally {
              setCreating(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setShowCreate(true);
          }}
        >
          Create patient
        </button>
      )}
    </div>
  );
}

function CreatePatientForm({
  onSubmit,
  onCancel,
  creating,
  error,
}: {
  onSubmit: (body: {
    mrn: string;
    fullName: string;
    dateOfBirth?: string;
    phone?: string;
  }) => Promise<void>;
  onCancel: () => void;
  creating: boolean;
  error: string | null;
}): ReactElement {
  const [mrn, setMrn] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  async function handleSubmit(
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    await onSubmit({
      mrn: mrn.trim(),
      fullName: fullName.trim(),
      ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
    });
  }

  return (
    <form
      className="patient-picker__create"
      onSubmit={(e) => void handleSubmit(e)}
    >
      <label className="field">
        <span className="field__label">Full name</span>
        <input
          required
          value={fullName}
          onChange={(event) => {
            setFullName(event.target.value);
          }}
          autoFocus
        />
      </label>
      <label className="field">
        <span className="field__label">MRN</span>
        <input
          required
          value={mrn}
          onChange={(event) => {
            setMrn(event.target.value);
          }}
        />
      </label>
      <label className="field">
        <span className="field__label">Phone (optional)</span>
        <input
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
      </label>
      {error !== null ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="wizard__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create and select'}
        </button>
      </div>
    </form>
  );
}
