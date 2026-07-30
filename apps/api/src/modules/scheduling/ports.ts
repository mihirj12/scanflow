import type {
  ClinicRecord,
  ExceptionRecord,
  ResourceRecord,
  SegmentRecord,
  ServiceTypeRecord,
  WorkingHoursRecord,
} from '../shared/records.js';

/**
 * Ports the scheduling use cases need. Implementations live under
 * `infra/repositories` and are wired only in `container.ts`.
 */
export interface ClinicRepository {
  getById(clinicId: string): Promise<ClinicRecord | null>;
}

export interface ResourceRepository {
  listActive(clinicId: string): Promise<readonly ResourceRecord[]>;
  listWorkingHours(
    resourceIds: readonly string[],
  ): Promise<readonly WorkingHoursRecord[]>;
  listExceptions(
    resourceIds: readonly string[],
    onDate: string,
  ): Promise<readonly ExceptionRecord[]>;
}

export interface ServiceTypeRepository {
  listByClinic(clinicId: string): Promise<readonly ServiceTypeRecord[]>;
  getByIds(ids: readonly string[]): Promise<readonly ServiceTypeRecord[]>;
}

export interface SegmentRepository {
  /**
   * Active segments whose patient interval overlaps the clinic-day window.
   * Used to build busy masks for resources and patients.
   */
  listActiveOverlappingDay(
    clinicId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<readonly SegmentRecord[]>;
}

export interface ScheduleVersionRepository {
  /**
   * Returns the current version, creating the row at version 1 if the day has
   * never been touched. Does not lock.
   */
  get(clinicId: string, onDate: string): Promise<number>;

  /**
   * Locks the clinic-day row (`SELECT … FOR UPDATE`) inside an open transaction
   * and returns its version, creating it at 1 if absent.
   */
  selectForUpdate(
    tx: unknown,
    clinicId: string,
    onDate: string,
  ): Promise<number>;

  /** Bumps the version by 1 inside an open transaction. */
  bump(tx: unknown, clinicId: string, onDate: string): Promise<number>;
}
