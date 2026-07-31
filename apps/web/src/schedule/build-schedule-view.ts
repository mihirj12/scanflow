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

/** Per-slot background for a resource lane. */
export type SlotAvailability = 'closed' | 'open' | 'booked';

/** A segment positioned on the CSS grid in slot units. */
export interface GridSegment {
  id: string;
  appointmentId: string;
  seq: number;
  kind: 'SERVICE' | 'DELAY' | 'VISIT';
  laneKey: string;
  /** 1-based CSS grid row (header is row 1; slot 0 → row 2). */
  startRow: number;
  rowSpan: number;
  status: ScheduleAppointment['status'];
  label: string;
  sublabel: string | null;
  durationMin: number;
  /** Dark fill when booked; light wash shows through open cells underneath. */
  booked: boolean;
}

export interface ScheduleViewModel {
  lanes: GridLane[];
  segments: GridSegment[];
  /** resourceId → availability per slot index. Patient lane omitted. */
  slotAvailability: ReadonlyMap<string, readonly SlotAvailability[]>;
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

  const openByResource = new Map(
    schedule.resourceAvailability.map((row) => [
      row.resourceId,
      new Set(row.openSlots),
    ]),
  );

  const bookedByResource = new Map<string, Set<number>>();
  for (const resource of resources) {
    bookedByResource.set(resource.id, new Set());
  }

  const segments: GridSegment[] = [];
  for (const appointment of schedule.appointments) {
    const visit = placeVisitSpan(appointment, dayStartMs, slotMs, totalSlots);
    if (visit !== null) segments.push(visit);

    for (const segment of appointment.segments) {
      if (segment.status !== 'ACTIVE') continue;
      const placed = placeSegment(
        segment,
        appointment,
        dayStartMs,
        slotMs,
        totalSlots,
      );
      if (placed !== null) {
        segments.push(placed);
        if (segment.kind === 'SERVICE' && segment.resourceId !== null) {
          const booked = bookedByResource.get(segment.resourceId);
          if (booked !== undefined) {
            const startSlot = placed.startRow - 2;
            for (
              let slot = startSlot;
              slot < startSlot + placed.rowSpan;
              slot++
            ) {
              booked.add(slot);
            }
          }
        }
      }
    }
  }

  const slotAvailability = new Map<string, readonly SlotAvailability[]>();
  for (const resource of resources) {
    const open = openByResource.get(resource.id) ?? new Set<number>();
    const booked = bookedByResource.get(resource.id) ?? new Set<number>();
    const row: SlotAvailability[] = [];
    for (let slot = 0; slot < totalSlots; slot++) {
      if (booked.has(slot)) row.push('booked');
      else if (open.has(slot)) row.push('open');
      else row.push('closed');
    }
    slotAvailability.set(resource.id, row);
  }

  return {
    lanes,
    segments,
    slotAvailability,
    slotMinutes: schedule.slotMinutes,
    dayStart: schedule.dayStart,
    totalSlots,
    timeLabels,
  };
}

function placeVisitSpan(
  appointment: ScheduleAppointment,
  dayStartMs: number,
  slotMs: number,
  totalSlots: number,
): GridSegment | null {
  const active = appointment.segments.filter(
    (segment) => segment.status === 'ACTIVE',
  );
  if (active.length === 0) return null;

  const startMs = Math.min(
    ...active.map((segment) => Date.parse(segment.patientStart)),
  );
  const endMs = Math.max(
    ...active.map((segment) => Date.parse(segment.patientEnd)),
  );
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

  return {
    id: `visit-${appointment.id}`,
    appointmentId: appointment.id,
    seq: 0,
    kind: 'VISIT',
    laneKey: 'patient',
    startRow: startSlot + 2,
    rowSpan: span,
    status: appointment.status,
    label: appointment.patientName,
    sublabel: appointment.templateNameAtBooking ?? 'Clinic visit',
    durationMin,
    booked: true,
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

  const appointmentType = appointment.templateNameAtBooking ?? 'Appointment';

  const label =
    segment.kind === 'DELAY'
      ? `Wait ${String(durationMin)}m`
      : appointment.patientName;

  const sublabel =
    segment.kind === 'DELAY'
      ? null
      : (segment.serviceTypeName ?? appointmentType);

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
    sublabel,
    durationMin,
    booked: segment.kind === 'SERVICE',
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
