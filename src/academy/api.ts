// The Console's fetcher for the Academy. The Console already holds the token
// from the consoleAuth flow. Everything sent through it is a read, except Start
// over's cleanup (./cleanup.ts), the one deliberate write. It takes the same options the content
// script's fetcher does, because one loader (src/training/load.ts) drives both:
// Data Storage list queries are POSTs authenticated with Bearer, everything
// under /api/v1/ uses Token.
import { rateLimitError } from '../net/rateLimit.js';
import type { GetOptions } from '../training/load.js';

// `T` is what the caller expects back. The wire is untyped JSON, so it defaults to `any`.
export function fetchAcademyApi<T = any>(
  path: string,
  { method = 'GET', body, auth = 'token' }: GetOptions = {},
): Promise<T> {
  const domain = sessionStorage.getItem('consoleDomain');
  const token = sessionStorage.getItem('consoleToken');
  const scheme = auth === 'bearer' ? 'Bearer' : 'Token';
  const headers: Record<string, string> = { Authorization: `${scheme} ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${domain}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => {
    if (r.status === 429) throw rateLimitError(r, 'API 429');
    if (!r.ok) throw new Error(`API ${r.status}`);
    // A DELETE answers 204 with no body (Start over's cleanup is the only sender).
    if (r.status === 204) return null;
    return r.json();
  });
}

export function whoami(): Promise<any> {
  return fetchAcademyApi('/api/v1/auth/user');
}
