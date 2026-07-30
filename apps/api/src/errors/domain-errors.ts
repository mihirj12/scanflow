/**
 * Typed domain errors. The HTTP layer maps each to an RFC 9457 problem; use
 * cases never `throw new Error("...")` because a string cannot carry a stable
 * `type` URI or a status code.
 *
 * None of these messages may contain a patient identifier — name, MRN, phone,
 * or date of birth. Refer to appointments and patients by opaque id only.
 */

export class DomainError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;

  constructor(args: {
    type: string;
    title: string;
    status: number;
    detail: string;
  }) {
    super(args.detail);
    this.name = new.target.name;
    this.type = args.type;
    this.title = args.title;
    this.status = args.status;
    this.detail = args.detail;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super({
      type: 'https://scanflow.local/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: `${entity} '${id}' was not found. Check the id and try again.`,
    });
  }
}

export class ConflictError extends DomainError {
  constructor(detail: string) {
    super({
      type: 'https://scanflow.local/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail,
    });
  }
}

/**
 * The client's view of the clinic-day is stale. The HTTP layer recomputes
 * suggestions and attaches them as `freshCandidates` so the receptionist does
 * not start over.
 */
export class StaleScheduleError extends DomainError {
  constructor() {
    super({
      type: 'https://scanflow.local/problems/stale-schedule',
      title: 'Schedule changed',
      status: 409,
      detail:
        'The schedule changed while you were choosing a time. Pick one of the fresh alternatives.',
    });
  }
}

/**
 * A resource or patient exclusion constraint rejected the insert. Same recovery
 * path as {@link StaleScheduleError}: recompute and return alternatives.
 */
export class SlotConflictError extends DomainError {
  constructor() {
    super({
      type: 'https://scanflow.local/problems/slot-conflict',
      title: 'That time was just booked',
      status: 409,
      detail:
        'Another user booked an overlapping slot. Pick one of the fresh alternatives.',
    });
  }
}

export class InvalidStatusTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super({
      type: 'https://scanflow.local/problems/invalid-status-transition',
      title: 'Invalid status change',
      status: 409,
      detail: `Cannot move an appointment from ${from} to ${to}. Choose a legal next status.`,
    });
  }
}

export class ValidationFailedError extends DomainError {
  readonly issues: readonly { path: PropertyKey[]; message: string }[];

  constructor(issues: readonly { path: PropertyKey[]; message: string }[]) {
    super({
      type: 'https://scanflow.local/problems/validation-failed',
      title: 'Validation failed',
      status: 400,
      detail:
        issues[0]?.message ??
        'The request failed validation. Fix the listed fields and try again.',
    });
    this.issues = issues;
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor() {
    super({
      type: 'https://scanflow.local/problems/idempotency-conflict',
      title: 'Idempotency key reused with a different body',
      status: 409,
      detail:
        'This Idempotency-Key was already used with a different request. Use a new key, or retry with the original body.',
    });
  }
}
