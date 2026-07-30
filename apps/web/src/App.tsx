import type {
  AppointmentDetail,
  CurrentUser,
  PatientDto,
} from '@scanflow/contracts';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  fetchAppointment,
  fetchPatient,
  postAppointmentStatus,
} from './api/client';
import { LoginPage } from './auth/LoginPage';
import { useSession } from './auth/useSession';
import { BookingWizard } from './booking/BookingWizard';
import type { GhostSegment } from './booking/ghost-preview';
import { AppointmentDrawer } from './management/AppointmentDrawer';
import { CommandPalette } from './management/CommandPalette';
import { printAppointmentSummary } from './management/print-summary';
import { ReschedulePanel } from './management/ReschedulePanel';
import {
  kebabActionsFor,
  statusActionPath,
  type KebabAction,
} from './management/status-actions';
import { ScheduleGrid } from './schedule/ScheduleGrid';
import { formatUpdatedAgo, useSchedule } from './schedule/use-schedule';
import { useScheduleStream } from './schedule/use-schedule-stream';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
});

/** Default to a Monday so seeded working hours apply in local demos. */
function defaultClinicDate(): string {
  return '2026-08-03';
}

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  );
}

/**
 * Nothing renders the grid until a session exists. The API would reject the
 * calls anyway; this keeps the UI from flashing an empty schedule first.
 */
function Gate(): ReactElement {
  const session = useSession();

  if (session.status === 'loading') {
    return <p className="app__empty">Restoring your session…</p>;
  }
  if (session.status === 'signed-out') {
    return <LoginPage onSignIn={session.signIn} />;
  }
  return (
    <AppShell
      user={session.user}
      onSignOut={() => {
        void session.signOut();
      }}
    />
  );
}

function AppShell({
  user,
  onSignOut,
}: {
  user: CurrentUser;
  onSignOut: () => void;
}): ReactElement {
  const client = useQueryClient();
  const [date, setDate] = useState(defaultClinicDate);
  const { view, schedule, isLoading, isError, error, dataUpdatedAt } =
    useSchedule(date);
  useScheduleStream(date, true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSession, setWizardSession] = useState(0);
  const [paletteSession, setPaletteSession] = useState<number | null>(null);
  const [ghostSegments, setGhostSegments] = useState<GhostSegment[]>([]);
  const [drawerAppointmentId, setDrawerAppointmentId] = useState<string | null>(
    null,
  );
  const [kebabSegmentId, setKebabSegmentId] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<{
    detail: AppointmentDetail;
    patient: PatientDto;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const timeZone = schedule?.timezone ?? 'UTC';

  const clearGhosts = useCallback(() => {
    setGhostSegments([]);
  }, []);

  const onGhostChange = useCallback((ghosts: GhostSegment[]) => {
    setGhostSegments(ghosts);
  }, []);

  const openWizard = useCallback(() => {
    setWizardSession((session) => session + 1);
    setWizardOpen(true);
  }, []);

  const openPalette = useCallback(() => {
    setPaletteSession((session) => (session ?? 0) + 1);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (
        (event.key === 'k' || event.key === 'K') &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.key !== 'n' && event.key !== 'N') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (wizardOpen || paletteSession !== null) return;
      event.preventDefault();
      openWizard();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [wizardOpen, paletteSession, openWizard, openPalette]);

  const kebabSegment =
    kebabSegmentId === null || view === undefined
      ? undefined
      : view.segments.find((segment) => segment.id === kebabSegmentId);
  const kebabActions =
    kebabSegment === undefined ? [] : kebabActionsFor(kebabSegment.status);

  async function runKebabAction(
    action: KebabAction,
    appointmentId: string,
  ): Promise<void> {
    setActionError(null);
    setKebabSegmentId(null);

    if (action.id === 'print' || action.id === 'reschedule') {
      try {
        const detail = await fetchAppointment(appointmentId);
        const patient = await fetchPatient(detail.patientId);
        if (action.id === 'print') {
          printAppointmentSummary(detail, patient, timeZone);
        } else {
          setDrawerAppointmentId(null);
          setReschedule({ detail, patient });
        }
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : 'Could not load this appointment.',
        );
      }
      return;
    }

    // Cancel asks for a reason, so it opens the drawer rather than firing here.
    if (action.id === 'cancel') {
      setDrawerAppointmentId(appointmentId);
      return;
    }

    if (action.toStatus === undefined) return;
    const path = statusActionPath(action.toStatus);
    if (path === null) return;
    try {
      await postAppointmentStatus(appointmentId, path);
      await client.invalidateQueries({ queryKey: ['schedule'] });
      await client.invalidateQueries({
        queryKey: ['appointment', appointmentId],
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'That action was rejected.',
      );
    }
  }

  const sidePanelOpen =
    wizardOpen || reschedule !== null || drawerAppointmentId !== null;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">ScanFlow</h1>
        <label className="app__date">
          <span className="app__date-label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </label>
        <button type="button" className="btn btn--ghost" onClick={openPalette}>
          Search
        </button>
        <button type="button" className="btn btn--primary" onClick={openWizard}>
          Book
        </button>
        <p className="app__live" aria-live="polite">
          {formatUpdatedAgo(dataUpdatedAt, nowMs)}
        </p>
        <p className="app__user">
          {user.displayName}
          <span className="app__role">{formatRole(user.role)}</span>
        </p>
        <button type="button" className="btn btn--ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <main className="app__main">
        {actionError !== null ? (
          <p className="app__error" role="alert">
            {actionError}
          </p>
        ) : null}

        {isLoading && view === undefined ? (
          <ScheduleSkeleton />
        ) : isError ? (
          <p className="app__error" role="alert">
            Could not load the schedule
            {error instanceof Error ? `: ${error.message}` : '.'} Check that the
            API is running, then pick the date again.
          </p>
        ) : view === undefined ? (
          <p className="app__empty">No schedule for this date.</p>
        ) : (
          <div
            className={[
              'app__workspace',
              sidePanelOpen ? 'app__workspace--booking' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="app__grid-pane">
              {view.segments.length === 0 ? (
                <p className="app__empty">
                  No appointments. Press N to book one.
                </p>
              ) : null}
              <ScheduleGrid
                lanes={view.lanes}
                segments={view.segments}
                timeLabels={view.timeLabels}
                totalSlots={view.totalSlots}
                ghostSegments={ghostSegments}
                onSegmentActivate={(appointmentId) => {
                  setReschedule(null);
                  setDrawerAppointmentId(appointmentId);
                }}
                kebabOpenSegmentId={kebabSegmentId}
                kebabActions={kebabActions}
                onKebabToggle={(segmentId) => {
                  setKebabSegmentId((current) =>
                    current === segmentId ? null : segmentId,
                  );
                }}
                onKebabClose={() => {
                  setKebabSegmentId(null);
                }}
                onKebabAction={(action, appointmentId) => {
                  void runKebabAction(action, appointmentId);
                }}
              />
            </div>

            <BookingWizard
              key={wizardSession}
              open={wizardOpen}
              onClose={() => {
                clearGhosts();
                setWizardOpen(false);
              }}
              viewedDate={date}
              schedule={schedule}
              lanes={view.lanes}
              onGhostChange={onGhostChange}
            />

            <AppointmentDrawer
              appointmentId={drawerAppointmentId}
              timeZone={timeZone}
              onClose={() => {
                setDrawerAppointmentId(null);
              }}
              onReschedule={(detail, patient) => {
                setDrawerAppointmentId(null);
                setReschedule({ detail, patient });
              }}
              onPrint={(detail, patient) => {
                printAppointmentSummary(detail, patient, timeZone);
              }}
            />

            {reschedule !== null && schedule !== undefined ? (
              <ReschedulePanel
                appointment={reschedule.detail}
                patient={reschedule.patient}
                date={date}
                timeZone={schedule.timezone}
                dayStart={schedule.dayStart}
                dayEnd={schedule.dayEnd}
                slotMinutes={schedule.slotMinutes}
                lanes={view.lanes}
                onGhostChange={onGhostChange}
                onClose={() => {
                  clearGhosts();
                  setReschedule(null);
                }}
                onDone={() => {
                  clearGhosts();
                  setReschedule(null);
                }}
              />
            ) : null}
          </div>
        )}
      </main>

      {paletteSession !== null ? (
        <CommandPalette
          key={paletteSession}
          onClose={() => {
            setPaletteSession(null);
          }}
          onSelectAppointment={(appointmentId) => {
            setReschedule(null);
            setDrawerAppointmentId(appointmentId);
          }}
          onSelectPatient={openWizard}
        />
      ) : null}
    </div>
  );
}

function formatRole(role: CurrentUser['role']): string {
  const words = role.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ScheduleSkeleton(): ReactElement {
  return (
    <div className="schedule-skeleton" aria-hidden="true">
      {Array.from({ length: 12 }, (_, row) => (
        <div key={row} className="schedule-skeleton__row" />
      ))}
    </div>
  );
}
