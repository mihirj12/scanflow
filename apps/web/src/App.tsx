import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';

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
  const { view, isLoading, isError, error, dataUpdatedAt } = useSchedule(date);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

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
        ) : view === undefined || view.segments.length === 0 ? (
          <p className="app__empty">No appointments. Press N to book one.</p>
        ) : (
          <ScheduleGrid
            lanes={view.lanes}
            segments={view.segments}
            timeLabels={view.timeLabels}
            totalSlots={view.totalSlots}
          />
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
