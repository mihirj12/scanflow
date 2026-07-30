/**
 * The access token lives in a module variable, never in localStorage or a
 * readable cookie: anything a script can read, an injected script can exfiltrate.
 * Losing it on reload is fine — the httpOnly refresh cookie mints a new one.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
