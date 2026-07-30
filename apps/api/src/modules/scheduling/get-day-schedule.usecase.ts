import type { GetScheduleResponse } from '@scanflow/contracts';

import { NotFoundError } from '../../errors/domain-errors.js';
import type { AppointmentRepository } from '../appointments/ports.js';
import { clinicDayWindow } from '../scheduling/day-grid.mapper.js';
import type {
  ClinicRepository,
  ResourceRepository,
  ScheduleVersionRepository,
  SegmentRepository,
} from '../scheduling/ports.js';

export interface GetDayScheduleDeps {
  clinics: ClinicRepository;
  resources: ResourceRepository;
  segments: SegmentRepository;
  scheduleVersions: ScheduleVersionRepository;
  appointments: AppointmentRepository;
}

export function createGetDayScheduleUseCase(deps: GetDayScheduleDeps) {
  return async function getDaySchedule(cmd: {
    clinicId: string;
    date: string;
  }): Promise<GetScheduleResponse> {
    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', cmd.clinicId);

    const day = clinicDayWindow(clinic.grid, cmd.date);
    const [resources, scheduleVersion, listed] = await Promise.all([
      deps.resources.listActive(cmd.clinicId),
      deps.scheduleVersions.get(cmd.clinicId, cmd.date),
      deps.appointments.list({
        clinicId: cmd.clinicId,
        date: cmd.date,
        limit: 200,
      }),
    ]);

    const patientIds = new Set(
      listed.items.map((item) => item.appointment.patientId),
    );

    const lanes = [
      ...resources.map((r) => ({
        key: r.id,
        kind: 'RESOURCE' as const,
        resourceId: r.id,
        label: r.name,
      })),
      ...[...patientIds].map((patientId) => ({
        key: `patient:${patientId}`,
        kind: 'PATIENT' as const,
        patientId,
        // Opaque label — never the patient's name (PHI ban).
        label: 'Patient',
      })),
    ];

    return {
      date: cmd.date,
      scheduleVersion,
      slotMinutes: clinic.grid.slotMinutes,
      dayStart: day.start.toUTC().toISO() ?? day.start.toJSDate().toISOString(),
      dayEnd: day.end.toUTC().toISO() ?? day.end.toJSDate().toISOString(),
      resources: resources.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        modalities: [...r.modalities],
        displayOrder: r.displayOrder,
      })),
      lanes,
      appointments: listed.items.map((item) => ({
        id: item.appointment.id,
        patientId: item.appointment.patientId,
        status: item.appointment.status,
        templateId: item.appointment.templateId,
        templateNameAtBooking: item.appointment.templateNameAtBooking,
        notes: item.appointment.notes,
        segments: item.segments
          .filter((s) => s.status === 'ACTIVE')
          .map((s) => ({
            id: s.id,
            appointmentId: s.appointmentId,
            seq: s.seq,
            kind: s.kind,
            resourceId: s.resourceId,
            patientId: s.patientId,
            patientStart: s.patientStart.toISOString(),
            patientEnd: s.patientEnd.toISOString(),
            resourceStart: s.resourceStart?.toISOString() ?? null,
            resourceEnd: s.resourceEnd?.toISOString() ?? null,
            status: s.status,
          })),
      })),
    };
  };
}
