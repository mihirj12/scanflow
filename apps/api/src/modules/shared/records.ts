import type {
  AppointmentStatus,
  ChainStep,
  ResourceType,
} from '@scanflow/contracts';

import type { ClinicDayGrid } from '../scheduling/day-grid.mapper.js';

/** Clinic row as the scheduling modules need it. */
export interface ClinicRecord {
  id: string;
  name: string;
  grid: ClinicDayGrid;
}

export interface ResourceRecord {
  id: string;
  type: ResourceType;
  name: string;
  modalities: readonly string[];
  displayOrder: number;
  active: boolean;
}

export interface WorkingHoursRecord {
  resourceId: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
}

export interface ExceptionRecord {
  resourceId: string;
  onDate: string;
  startsAt: string;
  endsAt: string;
  available: boolean;
}

export interface ServiceTypeRecord {
  id: string;
  code: string;
  name: string;
  resourceType: ResourceType;
  requiredModality: string | null;
}

/** A persisted segment, already decoded from `tstzrange`. */
export interface SegmentRecord {
  id: string;
  appointmentId: string;
  clinicId: string;
  patientId: string;
  seq: number;
  kind: 'SERVICE' | 'DELAY';
  serviceTypeId: string | null;
  resourceId: string | null;
  patientStart: Date;
  patientEnd: Date;
  resourceStart: Date | null;
  resourceEnd: Date | null;
  status: 'ACTIVE' | 'CANCELLED';
}

export interface AppointmentRecord {
  id: string;
  clinicId: string;
  patientId: string;
  templateId: string | null;
  templateNameAtBooking: string | null;
  onDate: string;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientRecord {
  id: string;
  clinicId: string;
  mrn: string;
  fullName: string;
  dateOfBirth: string | null;
  phone: string | null;
  createdAt: Date;
}

export interface TemplateRecord {
  id: string;
  clinicId: string;
  code: string;
  name: string;
  isPreset: boolean;
  active: boolean;
}

export interface NewSegment {
  seq: number;
  kind: 'SERVICE' | 'DELAY';
  serviceTypeId: string | null;
  resourceId: string | null;
  patientStart: Date;
  patientEnd: Date;
  resourceStart: Date | null;
  resourceEnd: Date | null;
}

export interface BookAppointmentInsert {
  clinicId: string;
  patientId: string;
  templateId: string | null;
  templateNameAtBooking: string | null;
  onDate: string;
  notes: string | null;
  createdBy: string | null;
  steps: readonly ChainStep[];
  segments: readonly NewSegment[];
}

export interface AuditWrite {
  clinicId: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

export interface IdempotencyWrite {
  clinicId: string;
  key: string;
  requestHash: string;
  method: string;
  path: string;
  statusCode: number;
  response: unknown;
}

export interface IdempotencyRead {
  requestHash: string;
  statusCode: number;
  response: unknown;
}
