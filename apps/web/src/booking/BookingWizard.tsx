import type {
  CandidateDto,
  ChainStep,
  ChainValidationContext,
  GetScheduleResponse,
  PatientDto,
  ServiceTypeDto,
} from '@scanflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import {
  ApiProblemError,
  bookAppointment,
  fetchResources,
  fetchServiceTypes,
  suggestAppointments,
} from '../api/client';
import type { GridLane } from '../schedule/build-schedule-view';

import { blankStep, chainIsValid } from './chain-editor';
import { ChainBuilder } from './ChainBuilder';
import { candidateToGhosts, type GhostSegment } from './ghost-preview';
import { PatientPicker } from './PatientPicker';
import { SuggestionsPanel } from './SuggestionsPanel';

type WizardPhase = 'patient' | 'chain' | 'date' | 'suggestions';

export interface BookingWizardProps {
  open: boolean;
  onClose: () => void;
  viewedDate: string;
  schedule: GetScheduleResponse | undefined;
  lanes: readonly GridLane[];
  onGhostChange: (ghosts: GhostSegment[]) => void;
}

/**
 * Remount via `key` when the parent opens a new session — that resets local
 * state without an effect that calls setState on open.
 */
export function BookingWizard({
  open,
  onClose,
  viewedDate,
  schedule,
  lanes,
  onGhostChange,
}: BookingWizardProps): ReactElement | null {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<WizardPhase>('patient');
  const [patient, setPatient] = useState<PatientDto | null>(null);
  const [steps, setSteps] = useState<ChainStep[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const [date, setDate] = useState(viewedDate);
  const [candidates, setCandidates] = useState<CandidateDto[]>([]);
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const [selected, setSelected] = useState<CandidateDto | null>(null);
  const [preview, setPreview] = useState<CandidateDto | null>(null);
  const [notes, setNotes] = useState('');
  const [conflictBanner, setConflictBanner] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  const serviceTypesQuery = useQuery({
    queryKey: ['service-types'],
    queryFn: fetchServiceTypes,
    enabled: open,
  });
  const resourcesQuery = useQuery({
    queryKey: ['resources'],
    queryFn: fetchResources,
    enabled: open,
  });

  const serviceTypes: readonly ServiceTypeDto[] =
    serviceTypesQuery.data?.items ?? [];

  const validationContext: ChainValidationContext | null =
    schedule === undefined || resourcesQuery.data === undefined
      ? null
      : {
          slotMinutes: schedule.slotMinutes,
          dayMinutes: Math.round(
            (Date.parse(schedule.dayEnd) - Date.parse(schedule.dayStart)) /
              60_000,
          ),
          serviceTypes: serviceTypes.map((s) => ({
            id: s.id,
            resourceType: s.resourceType,
            requiredModality: s.requiredModality,
          })),
          resources: resourcesQuery.data.items.map((r) => ({
            type: r.type,
            modalities: r.modalities,
            active: r.active,
          })),
        };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && phase !== 'suggestions') {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, phase]);

  useEffect(() => {
    if (preview === null || schedule === undefined) {
      onGhostChange([]);
      return;
    }
    onGhostChange(
      candidateToGhosts(
        preview,
        lanes,
        schedule.dayStart,
        schedule.slotMinutes,
        Math.max(
          1,
          Math.round(
            (Date.parse(schedule.dayEnd) - Date.parse(schedule.dayStart)) /
              (schedule.slotMinutes * 60_000),
          ),
        ),
      ),
    );
  }, [preview, schedule, lanes, onGhostChange]);

  if (!open) return null;

  function ensureBlankChain(): ChainStep[] {
    if (steps.length > 0) return steps;
    const first = serviceTypes[0];
    if (first === undefined) return steps;
    return [blankStep(first.id, 1)];
  }

  async function loadSuggestions(): Promise<void> {
    if (patient === null) return;
    setSuggesting(true);
    setSuggestError(null);
    setConflictBanner(null);
    setSelected(null);
    setPreview(null);
    try {
      const result = await suggestAppointments({
        patientId: patient.id,
        date,
        steps,
        ...(templateId === null ? {} : { templateId }),
      });
      setCandidates(result.candidates);
      setScheduleVersion(result.scheduleVersion);
      setPhase('suggestions');
    } catch (error) {
      setSuggestError(
        error instanceof Error ? error.message : 'Could not load suggestions.',
      );
    } finally {
      setSuggesting(false);
    }
  }

  async function confirmBook(): Promise<void> {
    if (patient === null || selected === null) return;
    setBooking(true);
    setBookError(null);
    try {
      await bookAppointment(
        {
          patientId: patient.id,
          date,
          steps,
          candidate: selected,
          scheduleVersion,
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
          ...(templateId === null ? {} : { templateId }),
        },
        crypto.randomUUID(),
      );
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      onGhostChange([]);
      onClose();
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 409) {
        const fresh = error.problem.freshCandidates ?? [];
        setCandidates(fresh);
        setSelected(null);
        setPreview(null);
        setConflictBanner(
          fresh.length === 0
            ? 'That time was just booked. No alternatives are available on this day.'
            : `That time was just booked. Here are ${String(fresh.length)} alternative${fresh.length === 1 ? '' : 's'}.`,
        );
        try {
          const refreshed = await suggestAppointments({
            patientId: patient.id,
            date,
            steps,
            ...(templateId === null ? {} : { templateId }),
          });
          setScheduleVersion(refreshed.scheduleVersion);
          if (fresh.length === 0) {
            setCandidates(refreshed.candidates);
          }
        } catch {
          // Keep the freshCandidates from the conflict response.
        }
      } else {
        setBookError(
          error instanceof Error ? error.message : 'Could not book.',
        );
      }
    } finally {
      setBooking(false);
    }
  }

  const canContinueFromChain =
    validationContext !== null && chainIsValid(steps, validationContext);

  return (
    <>
      <dialog
        ref={dialogRef}
        className="wizard-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="wizard">
          <header className="wizard__header">
            <h2 id={titleId} className="wizard__title">
              Book appointment
            </h2>
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              onClick={onClose}
            >
              Close
            </button>
          </header>

          <nav className="wizard__steps" aria-label="Booking steps">
            <StepLabel active={phase === 'patient'} done={patient !== null}>
              Patient
            </StepLabel>
            <StepLabel
              active={phase === 'chain'}
              done={phase === 'date' || phase === 'suggestions'}
            >
              Chain
            </StepLabel>
            <StepLabel active={phase === 'date'} done={phase === 'suggestions'}>
              Date
            </StepLabel>
          </nav>

          <div className="wizard__body">
            {phase === 'patient' ? (
              <PatientPicker selected={patient} onSelect={setPatient} />
            ) : null}

            {phase === 'chain' && validationContext !== null ? (
              <ChainBuilder
                steps={steps}
                serviceTypes={serviceTypes}
                validationContext={validationContext}
                templateId={templateId}
                templateName={templateName}
                modified={modified}
                onChange={(next) => {
                  setSteps(next.steps);
                  setTemplateId(next.templateId);
                  setTemplateName(next.templateName);
                  setModified(next.modified);
                }}
              />
            ) : null}

            {phase === 'chain' && validationContext === null ? (
              <p>Loading clinic configuration…</p>
            ) : null}

            {phase === 'date' ? (
              <label className="field">
                <span className="field__label">Appointment date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </label>
            ) : null}

            {suggestError !== null ? (
              <p className="field__error" role="alert">
                {suggestError}
              </p>
            ) : null}
          </div>

          <footer className="wizard__footer">
            {phase !== 'patient' ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  if (phase === 'chain') setPhase('patient');
                  if (phase === 'date') setPhase('chain');
                }}
              >
                Back
              </button>
            ) : (
              <span />
            )}

            {phase === 'patient' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={patient === null || serviceTypes[0] === undefined}
                title={
                  patient === null ? 'Select a patient to continue' : undefined
                }
                onClick={() => {
                  setSteps(ensureBlankChain());
                  setPhase('chain');
                }}
              >
                Continue
              </button>
            ) : null}

            {phase === 'chain' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canContinueFromChain}
                title={
                  canContinueFromChain
                    ? undefined
                    : 'Fix the chain errors above to continue'
                }
                onClick={() => {
                  setPhase('date');
                }}
              >
                Continue
              </button>
            ) : null}

            {phase === 'date' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={suggesting || date === ''}
                onClick={() => {
                  void loadSuggestions();
                }}
              >
                {suggesting ? 'Finding times…' : 'Find times'}
              </button>
            ) : null}
          </footer>
        </div>
      </dialog>

      {phase === 'suggestions' ? (
        <SuggestionsPanel
          candidates={candidates}
          steps={steps}
          timeZone={schedule?.timezone ?? 'UTC'}
          conflictBanner={conflictBanner}
          selected={selected}
          preview={preview}
          notes={notes}
          booking={booking}
          bookError={bookError}
          onPreview={setPreview}
          onSelect={setSelected}
          onNotesChange={setNotes}
          onBook={() => {
            void confirmBook();
          }}
          onBack={() => {
            setPhase('date');
            setPreview(null);
            onGhostChange([]);
          }}
          onClose={() => {
            onGhostChange([]);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

function StepLabel({
  children,
  active,
  done,
}: {
  children: string;
  active: boolean;
  done: boolean;
}): ReactElement {
  return (
    <span
      className={[
        'wizard__step',
        active ? 'wizard__step--active' : '',
        done ? 'wizard__step--done' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}
