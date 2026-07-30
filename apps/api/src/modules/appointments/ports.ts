import type { AppointmentStatus, ChainStep } from '@scanflow/contracts';

import type {
  AppointmentRecord,
  AuditWrite,
  BookAppointmentInsert,
  IdempotencyRead,
  IdempotencyWrite,
  NewSegment,
  PatientRecord,
  SegmentRecord,
  TemplateRecord,
} from '../shared/records.js';

export interface PatientRepository {
  getById(clinicId: string, patientId: string): Promise<PatientRecord | null>;
  search(
    clinicId: string,
    q: string | undefined,
    limit: number,
  ): Promise<readonly PatientRecord[]>;
  create(
    clinicId: string,
    input: {
      mrn: string;
      fullName: string;
      dateOfBirth?: string;
      phone?: string;
    },
  ): Promise<PatientRecord>;
}

export interface TemplateRepository {
  list(clinicId: string): Promise<readonly TemplateRecord[]>;
  getWithSteps(
    clinicId: string,
    templateId: string,
  ): Promise<{ template: TemplateRecord; steps: readonly ChainStep[] } | null>;
  create(
    clinicId: string,
    input: {
      code: string;
      name: string;
      steps: readonly ChainStep[];
      createdBy: string | null;
    },
  ): Promise<{ template: TemplateRecord; steps: readonly ChainStep[] }>;
}

export interface AppointmentRepository {
  getById(
    clinicId: string,
    appointmentId: string,
  ): Promise<{
    appointment: AppointmentRecord;
    steps: readonly ChainStep[];
    segments: readonly SegmentRecord[];
  } | null>;

  list(args: {
    clinicId: string;
    date?: string;
    status?: AppointmentStatus;
    q?: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: readonly {
      appointment: AppointmentRecord;
      steps: readonly ChainStep[];
      segments: readonly SegmentRecord[];
    }[];
    nextCursor: string | null;
  }>;

  /**
   * Inserts appointment + snapshotted steps + segments inside the caller's
   * transaction. Exclusion-constraint violations propagate as SQLSTATE 23P01.
   */
  insertBooking(
    tx: unknown,
    input: BookAppointmentInsert,
  ): Promise<{
    appointment: AppointmentRecord;
    segments: readonly SegmentRecord[];
  }>;

  /**
   * Atomically replaces segments for a reschedule: cancels the old ACTIVE ones
   * and inserts the new set. The appointment row stays; only its clock moves.
   */
  replaceSegments(
    tx: unknown,
    args: {
      appointmentId: string;
      clinicId: string;
      patientId: string;
      segments: readonly NewSegment[];
    },
  ): Promise<readonly SegmentRecord[]>;

  updateStatus(
    tx: unknown,
    args: {
      clinicId: string;
      appointmentId: string;
      status: AppointmentStatus;
      notes?: string;
    },
  ): Promise<AppointmentRecord>;
}

export interface AuditRepository {
  append(tx: unknown, row: AuditWrite): Promise<void>;
}

/**
 * Booking conflict rate. Counted in the use case rather than the HTTP layer
 * because only the use case can tell a genuine slot fight from a 409 raised by
 * an idempotency-key mistake.
 */
export interface BookingMetrics {
  bookingAttempted(): void;
  bookingConflicted(): void;
}

/**
 * Announces that a clinic-day changed, so open grids can refresh without
 * waiting for their next poll. Called after the transaction commits — never
 * inside it, or a rollback would still have told everyone the day changed.
 */
export interface ScheduleEventPublisher {
  publish(event: {
    clinicId: string;
    date: string;
    version: number;
  }): Promise<void>;
}

export interface IdempotencyRepository {
  find(clinicId: string, key: string): Promise<IdempotencyRead | null>;
  save(row: IdempotencyWrite): Promise<void>;
}

/**
 * Unit-of-work boundary for booking and other multi-step mutations.
 * The callback receives an opaque transaction handle that repository methods
 * accept; only the Drizzle adapter knows what it really is.
 */
export interface UnitOfWork {
  run<T>(work: (tx: unknown) => Promise<T>): Promise<T>;
}
