import type {
  GetScheduleResponse,
  ScheduleAppointment,
  ScheduleSegment,
} from '@scanflow/contracts';

/** One column on the grid: a clinical resource, or the shared patient lane. */
export interface GridLane {
  key: string;
  label: string;
  kind: 'RESOURCE' | 'PATIENT';
  resourceId?: string;
  resourceType?: 'DOCTOR' | 'NMT_ROOM' | 'SCAN_ROOM';
}

/** A segment positioned on the CSS grid in slot units. */
export interface GridSegment {
  id: string;
  appointmentId: string;
  seq: number;
  kind: 'SERVICE' | 'DELAY';
  laneKey: string;
  /** 1-based CSS grid row (header is row 1; slot 0 → row 2). */
  startRow: number;
  rowSpan: number;
  status: ScheduleAppointment['status'];
  label: string;
  durationMin: number;
}

export interface ScheduleViewModel {
  lanes: GridLane[];
  segments: GridSegment[];
  slotMinutes: number;
  dayStart: string;
  totalSlots: number;
  timeLabels: string[];
}

/**
 * Turns the schedule API payload into grid lanes and absolutely-placed
 * segments. Delays always land on a single Patient column — that is what makes
 * a five-block uptake study readable as one visit.
 */
export function buildScheduleView(
  schedule: GetScheduleResponse,
): ScheduleViewModel {
  const resources = [...schedule.resources].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );

  const lanes: GridLane[] = [
    ...resources.map((r) => ({
      key: r.id,
      label: r.name,
      kind: 'RESOURCE' as const,
      resourceId: r.id,
      resourceType: r.type,
    })),
    { key: 'patient', label: 'Patient', kind: 'PATIENT' as const },
  ];

  const dayStartMs = Date.parse(schedule.dayStart);
  const slotMs = schedule.slotMinutes * 60_000;
  const dayEndMs = Date.parse(schedule.dayEnd);
  const totalSlots = Math.max(1, Math.round((dayEndMs - dayStartMs) / slotMs));

  const timeLabels = Array.from({ length: totalSlots }, (_, slot) => {
    const instant = new Date(dayStartMs + slot * slotMs);
    return formatClock(instant, schedule.timezone);
  });

  const segments: GridSegment[] = [];
  for (const appointment of schedule.appointments) {
    for (const segment of appointment.segments) {
      if (segment.status !== 'ACTIVE') continue;
      const placed = placeSegment(
        segment,
        appointment,
        dayStartMs,
        slotMs,
        totalSlots,
      );
      if (placed !== null) segments.push(placed);
    }
  }

  return {
    lanes,
    segments,
    slotMinutes: schedule.slotMinutes,
    dayStart: schedule.dayStart,
    totalSlots,
    timeLabels,
  };
}

function placeSegment(
  segment: ScheduleSegment,
  appointment: ScheduleAppointment,
  dayStartMs: number,
  slotMs: number,
  totalSlots: number,
): GridSegment | null {
  const startMs = Date.parse(segment.patientStart);
  const endMs = Date.parse(segment.patientEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }

  const startSlot = Math.max(0, Math.floor((startMs - dayStartMs) / slotMs));
  const endSlot = Math.min(
    totalSlots,
    Math.ceil((endMs - dayStartMs) / slotMs),
  );
  const span = Math.max(1, endSlot - startSlot);
  const durationMin = Math.round((endMs - startMs) / 60_000);

  const laneKey =
    segment.kind === 'DELAY' ? 'patient' : (segment.resourceId ?? 'patient');

  const label =
    segment.kind === 'DELAY'
      ? `Wait ${String(durationMin)}m`
      : (appointment.templateNameAtBooking ?? `Step ${String(segment.seq)}`);

  return {
    id: segment.id,
    appointmentId: segment.appointmentId,
    seq: segment.seq,
    kind: segment.kind,
    laneKey,
    startRow: startSlot + 2,
    rowSpan: span,
    status: appointment.status,
    label,
    durationMin,
  };
}

function formatClock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(instant);
}

/** Sibling ids sharing an appointment — the highlight set for hover/focus. */
export function siblingsOf(
  segments: readonly GridSegment[],
  appointmentId: string,
): ReadonlySet<string> {
  return new Set(
    segments.filter((s) => s.appointmentId === appointmentId).map((s) => s.id),
  );
}
