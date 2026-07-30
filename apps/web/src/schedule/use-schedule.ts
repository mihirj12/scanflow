import type { GetScheduleResponse } from '@scanflow/contracts';
import { useQuery } from '@tanstack/react-query';

import { fetchSchedule } from '../api/client';

import {
  buildScheduleView,
  type ScheduleViewModel,
} from './build-schedule-view';

export function useSchedule(date: string): {
  view: ScheduleViewModel | undefined;
  schedule: GetScheduleResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  dataUpdatedAt: number;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ['schedule', date],
    queryFn: () => fetchSchedule(date),
    // Since M6 the SSE stream pushes changes within a second or two. Polling
    // stays as the safety net for a dropped stream, hence 60s rather than 15s.
    refetchInterval: 60_000,
  });

  const view =
    query.data === undefined ? undefined : buildScheduleView(query.data);

  return {
    view,
    schedule: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** Human-readable "updated Ns ago" for the live indicator. */
export function formatUpdatedAgo(dataUpdatedAt: number, nowMs: number): string {
  if (dataUpdatedAt === 0) return 'Waiting for first load';
  const seconds = Math.max(0, Math.floor((nowMs - dataUpdatedAt) / 1000));
  if (seconds < 5) return 'Updated just now';
  return `Updated ${String(seconds)}s ago`;
}
