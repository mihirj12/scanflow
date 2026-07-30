import type { CandidateDto, ChainStep } from '@scanflow/contracts';

import type { GridLane, GridSegment } from '../schedule/build-schedule-view';

/** A translucent overlay segment for a hovered suggestion. */
export interface GhostSegment {
  id: string;
  kind: 'SERVICE' | 'DELAY';
  laneKey: string;
  startRow: number;
  rowSpan: number;
  label: string;
  resourceType?: 'DOCTOR' | 'NMT_ROOM' | 'SCAN_ROOM';
}

/**
 * Places a candidate onto the same CSS grid coordinate system as booked
 * segments, so a hover preview sits in-place on the live schedule.
 */
export function candidateToGhosts(
  candidate: CandidateDto,
  lanes: readonly GridLane[],
  dayStartIso: string,
  slotMinutes: number,
  totalSlots: number,
): GhostSegment[] {
  const dayStartMs = Date.parse(dayStartIso);
  const slotMs = slotMinutes * 60_000;
  const ghosts: GhostSegment[] = [];

  for (const [index, placement] of candidate.placements.entries()) {
    const startMs = Date.parse(placement.patientStart);
    const endMs = Date.parse(placement.patientEnd);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      continue;
    }

    const startSlot = Math.max(0, Math.floor((startMs - dayStartMs) / slotMs));
    const endSlot = Math.min(
      totalSlots,
      Math.ceil((endMs - dayStartMs) / slotMs),
    );
    const span = Math.max(1, endSlot - startSlot);
    const durationMin = Math.round((endMs - startMs) / 60_000);

    const laneKey =
      placement.kind === 'DELAY'
        ? 'patient'
        : (placement.resourceId ?? 'patient');
    const lane = lanes.find((l) => l.key === laneKey);

    ghosts.push({
      id: `ghost-${String(index)}-${String(placement.seq)}-${placement.kind}`,
      kind: placement.kind,
      laneKey,
      startRow: startSlot + 2,
      rowSpan: span,
      label:
        placement.kind === 'DELAY'
          ? `Wait ${String(durationMin)}m`
          : `Step ${String(placement.seq)}`,
      ...(lane?.resourceType === undefined
        ? {}
        : { resourceType: lane.resourceType }),
    });
  }

  return ghosts;
}

/**
 * Copy for a suggestion row: clock range, span, incidental gap, and any
 * mandatory delay that was stretched past its minimum.
 */
export function describeCandidate(
  candidate: CandidateDto,
  steps: readonly ChainStep[],
  timeZone: string,
  isTightest: boolean,
): {
  timeRange: string;
  spanLabel: string;
  gapLabel: string;
  delayNotes: string[];
  badge: string | null;
} {
  const start = formatClock(candidate.start, timeZone);
  const end = formatClock(candidate.end, timeZone);
  const delayNotes: string[] = [];

  for (const placement of candidate.placements) {
    if (placement.kind !== 'DELAY') continue;
    const waitMin = Math.round(
      (Date.parse(placement.patientEnd) - Date.parse(placement.patientStart)) /
        60_000,
    );
    const step = steps.find((s) => s.seq === placement.seq);
    if (step === undefined) continue;
    if (waitMin > step.minGapMin) {
      delayNotes.push(
        `Wait before step ${String(placement.seq)} extended to ${String(waitMin)} min (resource busy)`,
      );
    }
  }

  return {
    timeRange: `${start}–${end}`,
    spanLabel: `${String(candidate.spanMinutes)} min`,
    gapLabel:
      candidate.incidentalGapMinutes === 0
        ? 'No incidental gap'
        : `${String(candidate.incidentalGapMinutes)} min incidental gap`,
    delayNotes,
    badge: isTightest ? 'Tightest fit' : null,
  };
}

function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

/** Maps booked grid segments — kept for type parity in ScheduleGrid props. */
export type { GridSegment };
