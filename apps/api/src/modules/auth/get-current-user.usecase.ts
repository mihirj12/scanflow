import type { CurrentUser } from '@scanflow/contracts';

import { UnauthenticatedError } from '../../errors/domain-errors.js';

import type { UserRepository } from './ports.js';

/**
 * Re-reads the user behind a valid access token, so a deactivated account stops
 * working before its 15-minute token expires.
 */
export function createGetCurrentUserUseCase(deps: { users: UserRepository }) {
  return async function getCurrentUser(query: {
    clinicId: string;
    userId: string;
  }): Promise<CurrentUser> {
    const user = await deps.users.findById(query.clinicId, query.userId);
    if (user?.active !== true) {
      throw new UnauthenticatedError(
        'That account can no longer sign in. Contact an administrator.',
      );
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
  };
}
