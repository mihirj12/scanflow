import type { CSSProperties, ReactElement } from 'react';

import type { GhostSegment } from '../booking/ghost-preview';

import type { GridLane, GridSegment } from './build-schedule-view';
import { useScheduleInteraction } from './use-schedule-interaction';

export interface ScheduleGridProps {
  lanes: readonly GridLane[];
  segments: readonly GridSegment[];
  timeLabels: readonly string[];
  totalSlots: number;
  /** Translucent overlay for a hovered suggestion — never interactive. */
  ghostSegments?: readonly GhostSegment[];
}

export function ScheduleGrid({
  lanes,
  segments,
  timeLabels,
  totalSlots,
  ghostSegments = [],
}: ScheduleGridProps): ReactElement {
  const interaction = useScheduleInteraction(segments);

  const style = {
    '--lane-count': String(lanes.length),
    '--slot-count': String(totalSlots),
  } as CSSProperties;

  return (
    <div
      className="schedule-grid"
      style={style}
      role="grid"
      aria-label="Day schedule"
    >
      <div className="schedule-grid__corner" role="columnheader">
        Time
      </div>
      {lanes.map((lane) => (
        <div
          key={lane.key}
          className="schedule-grid__lane-header"
          role="columnheader"
        >
          {lane.label}
        </div>
      ))}

      {timeLabels.map((label, slot) => (
        <div
          key={`time-${String(slot)}`}
          className="schedule-grid__time"
          style={{ gridRow: slot + 2 }}
          role="rowheader"
        >
          {label}
        </div>
      ))}

      {lanes.map((lane, laneIndex) =>
        Array.from({ length: totalSlots }, (_, slot) => (
          <div
            key={`${lane.key}-${String(slot)}`}
            className="schedule-grid__cell"
            style={{
              gridColumn: laneIndex + 2,
              gridRow: slot + 2,
            }}
            aria-hidden="true"
          />
        )),
      )}

      {segments.map((segment) => {
        const laneIndex = lanes.findIndex((l) => l.key === segment.laneKey);
        if (laneIndex < 0) return null;
        const highlighted = interaction.highlightedIds.has(segment.id);
        const resourceType =
          lanes[laneIndex]?.resourceType ??
          (segment.kind === 'DELAY' ? undefined : undefined);

        return (
          <button
            key={segment.id}
            type="button"
            data-segment-id={segment.id}
            className={[
              'schedule-segment',
              segment.kind === 'DELAY'
                ? 'schedule-segment--delay'
                : `schedule-segment--${resourceClass(resourceType ?? lanes[laneIndex]?.resourceType)}`,
              highlighted ? 'schedule-segment--lit' : '',
              isHeld(segment.status) ? 'schedule-segment--held' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              gridColumn: laneIndex + 2,
              gridRow: `${String(segment.startRow)} / span ${String(segment.rowSpan)}`,
            }}
            onMouseEnter={() => {
              interaction.onSegmentEnter(segment.id);
            }}
            onMouseLeave={interaction.onSegmentLeave}
            onFocus={() => {
              interaction.onSegmentFocus(segment.id);
            }}
            onKeyDown={(event) => {
              interaction.onSegmentKeyDown(event, segment.id);
            }}
          >
            <span className="schedule-segment__label">{segment.label}</span>
          </button>
        );
      })}

      {ghostSegments.map((ghost) => {
        const laneIndex = lanes.findIndex((l) => l.key === ghost.laneKey);
        if (laneIndex < 0) return null;
        return (
          <div
            key={ghost.id}
            className={[
              'schedule-segment',
              'schedule-segment--ghost',
              ghost.kind === 'DELAY'
                ? 'schedule-segment--delay'
                : `schedule-segment--${resourceClass(ghost.resourceType ?? lanes[laneIndex]?.resourceType)}`,
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              gridColumn: laneIndex + 2,
              gridRow: `${String(ghost.startRow)} / span ${String(ghost.rowSpan)}`,
            }}
            aria-hidden="true"
          >
            <span className="schedule-segment__label">{ghost.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function resourceClass(
  type: 'DOCTOR' | 'NMT_ROOM' | 'SCAN_ROOM' | undefined,
): string {
  if (type === 'DOCTOR') return 'doctor';
  if (type === 'NMT_ROOM') return 'nmt';
  if (type === 'SCAN_ROOM') return 'scan';
  return 'patient';
}

function isHeld(status: GridSegment['status']): boolean {
  return status === 'DRAFT';
}
