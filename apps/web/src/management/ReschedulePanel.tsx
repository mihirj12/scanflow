import type {
  AppointmentDetail,
  CandidateDto,
  PatientDto,
} from '@scanflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';

import {
  ApiProblemError,
  rescheduleAppointment,
  suggestAppointments,
} from '../api/client';
import {
  candidateToGhosts,
  describeCandidate,
  type GhostSegment,
} from '../booking/ghost-preview';
import type { GridLane } from '../schedule/build-schedule-view';

export interface ReschedulePanelProps {
  appointment: AppointmentDetail;
  patient: PatientDto;
  date: string;
  timeZone: string;
  dayStart: string;
  dayEnd: string;
  slotMinutes: number;
  lanes: readonly GridLane[];
  onGhostChange: (ghosts: GhostSegment[]) => void;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Reschedule reuses the M4 suggestion flow, seeded with the booked chain. The
 * chain is read from `appointment.steps` — the snapshot taken at booking, never
 * the template it came from.
 */
export function ReschedulePanel({
  appointment,
  patient,
  date,
  timeZone,
  dayStart,
  dayEnd,
  slotMinutes,
  lanes,
  onGhostChange,
  onClose,
  onDone,
}: ReschedulePanelProps): ReactElement {
  const queryClient = useQueryClient();
  const [freshCandidates, setFreshCandidates] = useState<CandidateDto[] | null>(
    null,
  );
  const [selected, setSelected] = useState<CandidateDto | null>(null);
  const [preview, setPreview] = useState<CandidateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const suggestions = useQuery({
    queryKey: ['reschedule-suggestions', appointment.id, date],
    queryFn: () =>
      suggestAppointments({
        patientId: patient.id,
        date,
        steps: appointment.steps,
        ...(appointment.templateId === null
          ? {}
          : { templateId: appointment.templateId }),
      }),
  });

  const candidates = freshCandidates ?? suggestions.data?.candidates ?? [];
  const scheduleVersion =
    suggestions.data?.scheduleVersion ?? appointment.scheduleVersion;

  useEffect(() => {
    if (preview === null) {
      onGhostChange([]);
      return;
    }
    const totalSlots = Math.max(
      1,
      Math.round(
        (Date.parse(dayEnd) - Date.parse(dayStart)) / (slotMinutes * 60_000),
      ),
    );
    onGhostChange(
      candidateToGhosts(preview, lanes, dayStart, slotMinutes, totalSlots),
    );
  }, [preview, dayStart, dayEnd, slotMinutes, lanes, onGhostChange]);

  async function confirm(): Promise<void> {
    if (selected === null) return;
    setSaving(true);
    setError(null);
    try {
      await rescheduleAppointment(
        appointment.id,
        { candidate: selected, scheduleVersion },
        crypto.randomUUID(),
      );
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      await queryClient.invalidateQueries({
        queryKey: ['appointment', appointment.id],
      });
      onGhostChange([]);
      onDone();
    } catch (err) {
      if (err instanceof ApiProblemError && err.status === 409) {
        // Same recovery as booking: keep the panel, swap in fresh alternatives.
        const fresh = err.problem.freshCandidates ?? [];
        setFreshCandidates(fresh);
        setSelected(null);
        setPreview(null);
        setBanner(
          fresh.length === 0
            ? 'That time was just taken. No alternatives are left on this day.'
            : `That time was just taken. Here are ${String(fresh.length)} alternative${fresh.length === 1 ? '' : 's'}.`,
        );
        await suggestions.refetch();
      } else {
        setError(err instanceof Error ? err.message : 'Could not reschedule.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="suggestions" aria-label="Reschedule suggestions">
      <div className="suggestions__header">
        <h2 className="suggestions__title">Reschedule</h2>
        <button
          type="button"
          className="btn btn--ghost btn--compact"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {banner !== null ? (
        <p className="suggestions__banner" role="alert">
          {banner}
        </p>
      ) : null}

      {suggestions.isLoading ? (
        <p className="suggestions__empty">Finding times…</p>
      ) : null}

      {suggestions.isError ? (
        <p className="field__error" role="alert">
          Could not load alternative times. Close this panel and try again.
        </p>
      ) : null}

      {!suggestions.isLoading && candidates.length === 0 ? (
        <p className="suggestions__empty">
          No alternative times fit this chain on {date}. Pick another day.
        </p>
      ) : null}

      <ul className="suggestions__list">
        {candidates.map((candidate, index) => {
          const copy = describeCandidate(
            candidate,
            appointment.steps,
            timeZone,
            index === 0,
          );
          const isSelected =
            selected !== null &&
            selected.start === candidate.start &&
            selected.end === candidate.end;
          return (
            <li key={`${candidate.start}-${candidate.end}-${String(index)}`}>
              <button
                type="button"
                className={[
                  'suggestions__row',
                  isSelected ? 'suggestions__row--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => {
                  setPreview(candidate);
                }}
                onMouseLeave={() => {
                  setPreview(null);
                }}
                onFocus={() => {
                  setPreview(candidate);
                }}
                onBlur={() => {
                  setPreview(null);
                }}
                onClick={() => {
                  setSelected(candidate);
                }}
              >
                <span className="suggestions__time">{copy.timeRange}</span>
                <span className="suggestions__meta">
                  {copy.spanLabel} · {copy.gapLabel}
                </span>
                {copy.badge !== null ? (
                  <span className="suggestions__badge">{copy.badge}</span>
                ) : null}
                {copy.delayNotes.map((note) => (
                  <span key={note} className="suggestions__note">
                    {note}
                  </span>
                ))}
              </button>
            </li>
          );
        })}
      </ul>

      {error !== null ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="suggestions__confirm">
        <div className="wizard__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Back
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected === null || saving}
            onClick={() => {
              void confirm();
            }}
          >
            {saving ? 'Rescheduling…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </aside>
  );
}
