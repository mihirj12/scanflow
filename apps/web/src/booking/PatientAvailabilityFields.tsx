import { type ReactElement } from 'react';

import { patientWindowIsInvalid } from './patient-window';

export interface PatientAvailabilityFieldsProps {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  onEnabledChange: (enabled: boolean) => void;
  onWindowStartChange: (value: string) => void;
  onWindowEndChange: (value: string) => void;
}

/** Optional clinic-local window the patient can attend on the chosen date. */
export function PatientAvailabilityFields({
  enabled,
  windowStart,
  windowEnd,
  onEnabledChange,
  onWindowStartChange,
  onWindowEndChange,
}: PatientAvailabilityFieldsProps): ReactElement {
  const invalid = patientWindowIsInvalid(enabled, windowStart, windowEnd);

  return (
    <fieldset className="patient-window">
      <label className="patient-window__toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            onEnabledChange(event.target.checked);
          }}
        />
        <span>Limit to patient availability</span>
      </label>

      {enabled ? (
        <div className="patient-window__times">
          <label className="field">
            <span className="field__label">Available from</span>
            <input
              type="time"
              value={windowStart}
              onChange={(event) => {
                onWindowStartChange(event.target.value);
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">Until</span>
            <input
              type="time"
              value={windowEnd}
              onChange={(event) => {
                onWindowEndChange(event.target.value);
              }}
            />
          </label>
        </div>
      ) : null}

      {enabled ? (
        <p className="patient-window__hint">
          The full visit — every step and wait — must finish inside this window.
        </p>
      ) : null}

      {invalid ? (
        <p className="field__error" role="alert">
          End time must be after start time.
        </p>
      ) : null}
    </fieldset>
  );
}
