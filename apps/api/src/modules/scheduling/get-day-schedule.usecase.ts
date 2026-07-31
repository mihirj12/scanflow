import type { GetScheduleResponse, UserRole } from '@scanflow/contracts';

import { NotFoundError } from '../../errors/domain-errors.js';
import type {
  AppointmentRepository,
  PatientRepository,
} from '../appointments/ports.js';
import {
  clinicDayWindow,
  openSlotsForResource,
} from '../scheduling/day-grid.mapper.js';
import type {
  ClinicRepository,
  ResourceRepository,
  ScheduleVersionRepository,
  ServiceTypeRepository,
} from '../scheduling/ports.js';

export interface GetDayScheduleDeps {
  clinics: ClinicRepository;
  resources: ResourceRepository;
  scheduleVersions: ScheduleVersionRepository;
  appointments: AppointmentRepository;
  patients: PatientRepository;
  serviceTypes: ServiceTypeRepository;
}

export function createGetDayScheduleUseCase(deps: GetDayScheduleDeps) {
  return async function getDaySchedule(cmd: {
    clinicId: string;
    date: string;
    actorRole: UserRole;
    actorResourceId: string | null;
  }): Promise<GetScheduleResponse> {
    const clinic = await deps.clinics.getById(cmd.clinicId);
    if (clinic === null) throw new NotFoundError('clinic', cmd.clinicId);

    const day = clinicDayWindow(clinic.grid, cmd.date);
    let resources = await deps.resources.listActive(cmd.clinicId);

    if (cmd.actorRole === 'CLINICIAN' && cmd.actorResourceId !== null) {
      resources = resources.filter((r) => r.id === cmd.actorResourceId);
    }

    const resourceIds = resources.map((r) => r.id);
    const [scheduleVersion, listed, serviceTypes, weekly, exceptions] =
      await Promise.all([
        deps.scheduleVersions.get(cmd.clinicId, cmd.date),
        deps.appointments.list({
          clinicId: cmd.clinicId,
          date: cmd.date,
          limit: 200,
        }),
        deps.serviceTypes.listByClinic(cmd.clinicId),
        deps.resources.listWorkingHours(resourceIds),
        deps.resources.listExceptions(resourceIds, cmd.date),
      ]);

    const serviceTypeById = new Map(
      serviceTypes.map((st) => [st.id, st.name] as const),
    );

    const patientIds = new Set(
      listed.items.map((item) => item.appointment.patientId),
    );
    const patients = await deps.patients.getByIds(cmd.clinicId, [
      ...patientIds,
    ]);

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
        label: patients.get(patientId)?.fullName ?? 'Patient',
      })),
    ];

    const resourceAvailability = resources.map((resource) => {
      const weeklyForResource = weekly.filter(
        (row) => row.resourceId === resource.id,
      );
      const exceptionsForResource = exceptions.filter(
        (row) => row.resourceId === resource.id,
      );
      const open = openSlotsForResource(
        clinic.grid,
        cmd.date,
        weeklyForResource,
        exceptionsForResource,
      );
      return {
        resourceId: resource.id,
        openSlots: [...open].sort((a, b) => a - b),
      };
    });

    let appointments = listed.items
      .filter((item) => item.appointment.status !== 'CANCELLED')
      .map((item) => {
        const stepServiceName = new Map<number, string>();
        for (const step of item.steps) {
          const name = serviceTypeById.get(step.serviceTypeId);
          if (name !== undefined) {
            stepServiceName.set(step.seq, name);
          }
        }
        const patient = patients.get(item.appointment.patientId);

        return {
          id: item.appointment.id,
          patientId: item.appointment.patientId,
          patientName: patient?.fullName ?? 'Patient',
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
              serviceTypeName:
                s.kind === 'DELAY'
                  ? null
                  : (stepServiceName.get(s.seq) ?? null),
            })),
        };
      });

    if (cmd.actorRole === 'CLINICIAN' && cmd.actorResourceId !== null) {
      appointments = appointments.filter((item) =>
        item.segments.some(
          (segment) => segment.resourceId === cmd.actorResourceId,
        ),
      );
    }

    return {
      date: cmd.date,
      scheduleVersion,
      slotMinutes: clinic.grid.slotMinutes,
      timezone: clinic.grid.timezone,
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
      resourceAvailability,
      appointments,
    };
  };
}
