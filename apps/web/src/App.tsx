import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { BookingWizard } from './booking/BookingWizard';
import type { GhostSegment } from './booking/ghost-preview';
import { ScheduleGrid } from './schedule/ScheduleGrid';
import { formatUpdatedAgo, useSchedule } from './schedule/use-schedule';

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
      <AppShell />
    </QueryClientProvider>
  );
}

function AppShell(): ReactElement {
  const [date, setDate] = useState(defaultClinicDate);
  const { view, schedule, isLoading, isError, error, dataUpdatedAt } =
    useSchedule(date);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSession, setWizardSession] = useState(0);
  const [ghostSegments, setGhostSegments] = useState<GhostSegment[]>([]);

  const clearGhosts = useCallback(() => {
    setGhostSegments([]);
  }, []);

  const onGhostChange = useCallback((ghosts: GhostSegment[]) => {
    setGhostSegments(ghosts);
  }, []);

  const openWizardStable = useCallback(() => {
    setWizardSession((session) => session + 1);
    setWizardOpen(true);
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
      if (wizardOpen) return;
      event.preventDefault();
      openWizardStable();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [wizardOpen, openWizardStable]);

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
        <button
          type="button"
          className="btn btn--primary"
          onClick={openWizardStable}
        >
          Book
        </button>
        <p className="app__live" aria-live="polite">
          {formatUpdatedAgo(dataUpdatedAt, nowMs)}
        </p>
      </header>
      <main className="app__main">
        {isLoading && view === undefined ? (
          <ScheduleSkeleton />
        ) : isError ? (
          <p className="app__error" role="alert">
            Could not load the schedule
            {error instanceof Error ? `: ${error.message}` : '.'} Check that the
            API is running, then pick the date again.
          </p>
        ) : view === undefined ? (
          <p className="app__empty">No schedule data for this date.</p>
        ) : (
          <div
            className={[
              'app__workspace',
              wizardOpen ? 'app__workspace--booking' : '',
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
          </div>
        )}
      </main>
    </div>
  );
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
