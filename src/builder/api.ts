// src/builder/api.ts
// REST client for the Builder. Same error behaviour as src/galaxy/api.ts (Bearer auth,
// 30s timeout, 401 -> session expired, 403 -> featureUnavailable, 429 -> rateLimitError),
// plus the two writes the Builder makes: schema validate (a dry run) and schema PATCH.

import { rateLimitError } from '../net/rateLimit.js';

export type ApiError = Error & { status: number; featureUnavailable?: boolean };

/** One Rossum resource as the API returns it — untyped on the wire. */
export type RawResource = Record<string, any>;

type RequestOpts = { signal?: AbortSignal | null };

let baseDomain = '';
let authHeader = '';

export function init(domain: string, token: string): void {
  baseDomain = domain;
  authHeader = `Bearer ${token}`;
}

const REQUEST_TIMEOUT = 30_000;

function apiError(message: string, status: number): ApiError {
  const e = new Error(message) as ApiError;
  e.status = status;
  return e;
}

function toUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseDomain}${pathOrUrl}`;
}

async function request(
  method: string,
  pathOrUrl: string,
  body?: unknown,
  { signal: external }: RequestOpts = {},
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
  const headers: Record<string, string> = { Authorization: authHeader, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(toUrl(pathOrUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !external?.aborted) {
      throw apiError('Request timed out after 30s', 0);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    throw apiError('Session expired. Open a Rossum page and open the Console again to reconnect.', 401);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail || data?.message || (data ? JSON.stringify(data) : '');
    if (res.status === 429) throw rateLimitError(res, detail || 'API error 429');
    const err = apiError(detail || `API error ${res.status}`, res.status);
    if (res.status === 403) err.featureUnavailable = true;
    throw err;
  }
  return data;
}

export function get(pathOrUrl: string, opts?: RequestOpts): Promise<any> {
  return request('GET', pathOrUrl, undefined, opts);
}

export async function listAll(pathOrUrl: string, opts?: RequestOpts): Promise<RawResource[]> {
  const out: RawResource[] = [];
  let next: string | null = pathOrUrl;
  while (next) {
    const page = await get(next, opts);
    if (Array.isArray(page?.results)) out.push(...page.results);
    next = page?.pagination?.next || null;
  }
  return out;
}

export function whoami(): Promise<any> {
  return get('/api/v1/auth/user/');
}

export function listWorkspaces(): Promise<RawResource[]> {
  return listAll('/api/v1/workspaces/?page_size=100');
}

export function listQueues(): Promise<RawResource[]> {
  return listAll('/api/v1/queues/?page_size=100');
}

export function getSchema(id: number): Promise<any> {
  return get(`/api/v1/schemas/${id}`);
}

/** Returns the body as is: `{}` means valid. The endpoint answers 200 either way. */
export function validateSchema(id: number, content: any[]): Promise<any> {
  return request('POST', '/api/v1/schemas/validate', { id, content });
}

export function patchSchema(id: number, content: any[]): Promise<any> {
  return request('PATCH', `/api/v1/schemas/${id}`, { content });
}
