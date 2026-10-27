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
    throw apiError(
      'Session expired. Open a Rossum page and open the Console again to reconnect.',
      401,
    );
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
    next = page?.pagination?.next || page?.next || null; // engine_fields: cursor pages
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

export function listSchemas(): Promise<RawResource[]> {
  return listAll('/api/v1/schemas/?page_size=100');
}

/** The native Rules attached to a queue. */
export function listRules(queueId: number): Promise<RawResource[]> {
  return listAll(`/api/v1/rules/?queue=${queueId}&page_size=100`);
}

export function getSchema(id: number): Promise<any> {
  return get(`/api/v1/schemas/${id}`);
}

/** One page: the queue's 20 newest annotations, with their documents sideloaded for names. */
export function listAnnotations(queueId: number): Promise<any> {
  return get(
    `/api/v1/annotations/?queue=${queueId}&ordering=-created_at&page_size=20&sideload=documents`,
  );
}

export function getAnnotationContent(id: number): Promise<any> {
  return get(`/api/v1/annotations/${id}/content`);
}

/** Returns the body as is: `{}` means valid. The endpoint answers 200 either way. */
export function validateSchema(id: number, content: any[]): Promise<any> {
  return request('POST', '/api/v1/schemas/validate', { id, content });
}

export function patchSchema(id: number, content: any[], name?: string): Promise<any> {
  return request(
    'PATCH',
    `/api/v1/schemas/${id}`,
    name === undefined ? { content } : { content, name },
  );
}

export function createWorkspace(name: string, organization: string): Promise<any> {
  return request('POST', '/api/v1/workspaces/', { name, organization });
}

export function createSchema(name: string, content: any[]): Promise<any> {
  return request('POST', '/api/v1/schemas/', { name, content });
}

export function createQueue(name: string, workspace: string, schema: string): Promise<any> {
  return request('POST', '/api/v1/queues/', { name, workspace, schema });
}

/** Immediate and permanent: `delete_after=0` skips the API's default 24 h grace period. */
export function deleteQueue(id: number): Promise<any> {
  return request('DELETE', `/api/v1/queues/${id}?delete_after=0`);
}

export function deleteSchema(id: number): Promise<any> {
  return request('DELETE', `/api/v1/schemas/${id}`);
}

export function createRule(body: Record<string, unknown>): Promise<any> {
  return request('POST', '/api/v1/rules/', body);
}

export function getRule(id: number): Promise<any> {
  return get(`/api/v1/rules/${id}`);
}

export function patchRule(id: number, body: Record<string, unknown>): Promise<any> {
  return request('PATCH', `/api/v1/rules/${id}`, body);
}

/** A queue's custom engine fields; `name` binds each to the schema datapoint of that id. */
export function listEngineFields(engineId: number): Promise<RawResource[]> {
  return listAll(`/api/v1/engine_fields?engine=${engineId}`);
}

/** The pretrained catalog: the seeds for engine fields and the generic engine's AI fields. */
export async function listPreTrainedFields(): Promise<RawResource[]> {
  const r = await get('/api/v1/engine_fields/pre_trained_fields');
  return Array.isArray(r) ? r : Array.isArray(r?.results) ? r.results : [];
}

export function createEngineField(body: Record<string, unknown>): Promise<any> {
  return request('POST', '/api/v1/engine_fields', body);
}

export function patchEngineField(id: number, body: Record<string, unknown>): Promise<any> {
  return request('PATCH', `/api/v1/engine_fields/${id}`, body);
}

/** 409 while a schema datapoint still uses the field's name. */
export function deleteEngineField(id: number): Promise<any> {
  return request('DELETE', `/api/v1/engine_fields/${id}`);
}

/** The hooks attached to a queue (the Builder keeps the MDH ones). */
export function listHooks(queueId: number): Promise<RawResource[]> {
  return listAll(`/api/v1/hooks/?queue=${queueId}&page_size=100`);
}

export function getHook(id: number): Promise<any> {
  return get(`/api/v1/hooks/${id}`);
}

/** Replaces the hook's whole `settings` object; secrets are a separate field and untouched. */
export function patchHookSettings(id: number, settings: Record<string, unknown>): Promise<any> {
  return request('PATCH', `/api/v1/hooks/${id}`, { settings });
}

export function getAnnotation(id: number): Promise<any> {
  return get(`/api/v1/annotations/${id}`);
}

/** Puts the annotation in `reviewing`, locked to this user; validate needs that (else 409). */
export function startAnnotation(id: number): Promise<any> {
  return request('POST', `/api/v1/annotations/${id}/start`);
}

/** Runs validation as a reviewer's edit would: formulas, hooks and rules. */
export function validateAnnotation(id: number): Promise<any> {
  return request('POST', `/api/v1/annotations/${id}/content/validate`, {
    actions: ['user_update', 'started'],
  });
}

/**
 * Evaluate rules on annotation content without saving them: Rossum's internal endpoint behind
 * its rule editor preview (undocumented; see ruleEval.ts).
 */
export function evaluateRules(body: Record<string, unknown>): Promise<any> {
  return request('POST', '/api/v1/internal/rules/evaluate_rules', body);
}

/** Hands a started annotation back (to `to_review`). */
export function cancelAnnotation(id: number): Promise<any> {
  return request('POST', `/api/v1/annotations/${id}/cancel`);
}
