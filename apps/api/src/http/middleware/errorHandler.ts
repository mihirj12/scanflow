import type { CandidateDto, ChainStep } from '@scanflow/contracts';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

import {
  DomainError,
  SlotConflictError,
  StaleScheduleError,
  ValidationFailedError,
} from '../../errors/domain-errors.js';

export type FreshCandidateLoader = (args: {
  clinicId: string;
  patientId: string;
  date: string;
  steps: readonly ChainStep[];
}) => Promise<CandidateDto[]>;

/**
 * Maps typed domain errors to RFC 9457 problem+json.
 *
 * For slot conflicts and stale schedule versions, attaches `freshCandidates`
 * so the receptionist can pick an alternative without starting over.
 */
export function errorHandler(deps: {
  log: Logger;
  clinicId: string;
  loadFreshCandidates: FreshCandidateLoader;
}) {
  return (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    void (async () => {
      if (error instanceof ValidationFailedError) {
        res
          .status(error.status)
          .type('application/problem+json')
          .json({
            type: error.type,
            title: error.title,
            status: error.status,
            detail: error.detail,
            issues: error.issues.map((issue) => ({
              path: issue.path.map(String),
              message: issue.message,
            })),
          });
        return;
      }

      if (
        error instanceof SlotConflictError ||
        error instanceof StaleScheduleError
      ) {
        const body = req.body as {
          patientId?: string;
          date?: string;
          steps?: ChainStep[];
        };
        let freshCandidates: CandidateDto[] = [];
        if (
          typeof body.patientId === 'string' &&
          typeof body.date === 'string' &&
          Array.isArray(body.steps)
        ) {
          try {
            freshCandidates = await deps.loadFreshCandidates({
              clinicId: deps.clinicId,
              patientId: body.patientId,
              date: body.date,
              steps: body.steps,
            });
          } catch {
            freshCandidates = [];
          }
        }

        const detail =
          freshCandidates.length > 0
            ? `${error.detail} ${String(freshCandidates.length)} alternative${freshCandidates.length === 1 ? '' : 's'} available.`
            : error.detail;

        res.status(error.status).type('application/problem+json').json({
          type: error.type,
          title: error.title,
          status: error.status,
          detail,
          freshCandidates,
        });
        return;
      }

      if (error instanceof DomainError) {
        res.status(error.status).type('application/problem+json').json({
          type: error.type,
          title: error.title,
          status: error.status,
          detail: error.detail,
        });
        return;
      }

      deps.log.error({ err: error }, 'unhandled error');
      res.status(500).type('application/problem+json').json({
        type: 'https://scanflow.local/problems/internal',
        title: 'Internal error',
        status: 500,
        detail:
          'Something went wrong. Retry the request, or contact support if it persists.',
      });
    })();
  };
}
