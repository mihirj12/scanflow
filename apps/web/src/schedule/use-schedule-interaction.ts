import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';

import { siblingsOf, type GridSegment } from './build-schedule-view';

/**
 * Hover/focus sibling highlighting and arrow-key navigation between segments.
 * Kept out of components so the grid stays a pure renderer (M3-07).
 */
export function useScheduleInteraction(segments: readonly GridSegment[]): {
  highlightedIds: ReadonlySet<string>;
  focusedId: string | undefined;
  onSegmentEnter: (segmentId: string) => void;
  onSegmentLeave: () => void;
  onSegmentFocus: (segmentId: string) => void;
  onSegmentKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    segmentId: string,
  ) => void;
} {
  const [hoveredAppointmentId, setHoveredAppointmentId] = useState<
    string | undefined
  >(undefined);
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);

  const byId = useMemo(() => {
    const map = new Map<string, GridSegment>();
    for (const segment of segments) map.set(segment.id, segment);
    return map;
  }, [segments]);

  // Drop a stale focus id without an effect — derive from current segments.
  const activeFocusedId =
    focusedId !== undefined && byId.has(focusedId) ? focusedId : undefined;

  const ordered = useMemo(
    () =>
      [...segments].sort((a, b) =>
        a.startRow === b.startRow
          ? a.laneKey.localeCompare(b.laneKey)
          : a.startRow - b.startRow,
      ),
    [segments],
  );

  const highlightedIds = useMemo(() => {
    const appointmentId =
      hoveredAppointmentId ??
      (activeFocusedId === undefined
        ? undefined
        : byId.get(activeFocusedId)?.appointmentId);
    if (appointmentId === undefined) return new Set<string>();
    return siblingsOf(segments, appointmentId);
  }, [hoveredAppointmentId, activeFocusedId, byId, segments]);

  const onSegmentEnter = useCallback(
    (segmentId: string) => {
      const segment = byId.get(segmentId);
      if (segment !== undefined) setHoveredAppointmentId(segment.appointmentId);
    },
    [byId],
  );

  const onSegmentLeave = useCallback(() => {
    setHoveredAppointmentId(undefined);
  }, []);

  const onSegmentFocus = useCallback((segmentId: string) => {
    setFocusedId(segmentId);
  }, []);

  const onSegmentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, segmentId: string) => {
      const index = ordered.findIndex((s) => s.id === segmentId);
      if (index < 0) return;

      let next: number | undefined;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        next = Math.min(ordered.length - 1, index + 1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        next = Math.max(0, index - 1);
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = ordered.length - 1;
      } else if (event.key === 'Escape') {
        event.currentTarget.blur();
        setFocusedId(undefined);
        return;
      }

      if (next === undefined || next === index) return;
      event.preventDefault();
      const target = ordered[next];
      if (target === undefined) return;
      setFocusedId(target.id);
      const node = document.querySelector<HTMLElement>(
        `[data-segment-id="${target.id}"]`,
      );
      node?.focus();
    },
    [ordered],
  );

  return {
    highlightedIds,
    focusedId: activeFocusedId,
    onSegmentEnter,
    onSegmentLeave,
    onSegmentFocus,
    onSegmentKeyDown,
  };
}
