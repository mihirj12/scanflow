import { loginBodySchema } from '@scanflow/contracts';
import { useId, useState, type ReactElement, type SyntheticEvent } from 'react';

import { ApiProblemError } from '../api/client';

export interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
}

/**
 * Sign-in. Validation uses the same Zod schema the API validates with, so the
 * inline message and the 400 can never disagree.
 */
export function LoginPage({ onSignIn }: LoginPageProps): ReactElement {
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = loginBodySchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          'Enter an email address and a password of at least 8 characters.',
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSignIn(parsed.data.email, parsed.data.password);
    } catch (err) {
      setError(
        err instanceof ApiProblemError
          ? err.problem.detail
          : 'Could not sign in. Check that the API is running.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form
        className="login__card"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <h1 className="login__title">ScanFlow</h1>
        <p className="login__subtitle">Sign in to the scheduling desk.</p>

        <label className="field" htmlFor={emailId}>
          <span className="field__label">Email</span>
          <input
            id={emailId}
            type="email"
            autoComplete="username"
            value={email}
            autoFocus
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>

        <label className="field" htmlFor={passwordId}>
          <span className="field__label">Password</span>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </label>

        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
