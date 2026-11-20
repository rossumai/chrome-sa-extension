// src/sftp/api.ts
// REST client for the SFTP app. Its writes, all on a user's click: creating, patching and
// deleting the org's SFTP helper hooks (servers.ts), and invoking one — which is what reaches
// the SFTP server, where upload, rename and delete change files. 401 -> session expired,
// 429 -> rateLimitError, never retried.
import { rateLimitError } from '../net/rateLimit.js';
import { domain, token } from './store.js';
import {
  createBody,
  editBody,
  pinBody,
  serverFromHook,
  type Server,
  type ServerInput,
} from './servers.js';
import type { Entry } from './arrivals.js';

const REQUEST_TIMEOUT = 30_000;
// Rossum itself gives up on an invocation after the hook's 30 s; this only bounds the wait for
// Rossum's answer, retries of a starting function aside.
const INVOKE_TIMEOUT = 60_000;
// A just-created or just-patched function answers "Initializing" for a few seconds.
const INIT_RETRIES = 40;
const INIT_WAIT = 3_000;

async function request(
  method: string,
  pathOrUrl: string,
  body?: unknown,
  timeout = REQUEST_TIMEOUT,
): Promise<{ status: number; data: any }> {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${domain.value}${pathOrUrl}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token.value}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError')
      throw new Error(`The request timed out after ${timeout / 1000} s.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401)
    throw new Error('Session expired. Open a Rossum page and open the Console again to reconnect.');
  if (res.status === 429) throw rateLimitError(res, 'HTTP 429');
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function failure(status: number, data: any): Error {
  const detail = typeof data?.detail === 'string' ? data.detail : '';
  // Rossum's own deadline for a function, worded for the user; the raw text names a Lambda URL.
  if (/read timeout on endpoint/i.test(detail))
    return new Error(
      'The helper did not answer within 30 seconds. The server may be slow, or the action too big.',
    );
  return new Error(detail || `HTTP ${status}`);
}

async function ok(method: string, path: string, body?: unknown): Promise<any> {
  const { status, data } = await request(method, path, body);
  if (status >= 300) throw failure(status, data);
  return data;
}

export async function listServers(): Promise<Server[]> {
  const out: Server[] = [];
  let next: string | null = '/api/v1/hooks?type=function&page_size=100';
  while (next) {
    const page: any = await ok('GET', next);
    for (const hook of page?.results ?? []) {
      const s = serverFromHook(hook);
      if (s) out.push(s);
    }
    next = typeof page?.pagination?.next === 'string' ? page.pagination.next : null;
  }
  return out.sort((a, b) => a.host.localeCompare(b.host) || a.user.localeCompare(b.user));
}

export async function createServer(input: ServerInput): Promise<Server> {
  return serverFromHook(await ok('POST', '/api/v1/hooks', createBody(input)))!;
}

export async function editServer(server: Server, input: ServerInput): Promise<Server> {
  return serverFromHook(await ok('PATCH', server.hookUrl, editBody(server, input)))!;
}

/** Pins `hostKey` (or keeps the pinned one) and brings the helper's code up to date. */
export async function pinServer(server: Server, hostKey: string | null): Promise<Server> {
  return serverFromHook(await ok('PATCH', server.hookUrl, pinBody(server, hostKey)))!;
}

export async function removeServer(server: Server): Promise<void> {
  await ok('DELETE', server.hookUrl);
}

// ── SFTP operations, through the helper ─────────────────────────────────────

// `depth: 1` also lists the subfolders; `offset`/`length` address one part of a file (see
// transfer.ts); `replace` lets a rename overwrite its target.
export type Op =
  | { op: 'list'; path: string; depth?: number }
  | { op: 'download'; path: string; offset?: number; length?: number }
  | { op: 'upload'; path: string; data: string; offset?: number }
  | { op: 'delete'; path: string }
  | { op: 'rename'; path: string; to: string; replace?: boolean };

export type OpResult = {
  ok: boolean;
  error?: string;
  entries?: Entry[];
  /** With `depth: 1`: each subfolder's listing, by name. */
  children?: Record<string, Entry[]>;
  data?: string;
  /** With `download`: the whole file's size, so the caller knows how many parts remain. */
  size?: number;
};

export type HelperError = Error & { hostKeyChanged?: boolean; hostKey?: string };

export type Invocation = { hostKey: string; results: OpResult[] };

const initializing = (status: number, data: any) =>
  (status === 400 || status === 409) &&
  /initializ/i.test(typeof data === 'string' ? data : String(data?.detail ?? ''));

/**
 * Runs `ops` in one SSH session. `onWait` hears that the helper is still starting (a fresh
 * or just-updated function), so the page can say why it takes long. Throws for a session
 * that never started (sign-in, network, host key); a single op's failure is in its result.
 */
export async function invoke(
  server: Server,
  ops: Op[],
  onWait?: () => void,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<Invocation> {
  for (let attempt = 0; ; attempt++) {
    const { status, data } = await request(
      'POST',
      `${server.hookUrl}/invoke`,
      { ops },
      INVOKE_TIMEOUT,
    );
    if (initializing(status, data) && attempt < INIT_RETRIES) {
      onWait?.();
      await sleep(INIT_WAIT);
      continue;
    }
    if (status >= 300) throw failure(status, data);
    if (typeof data?.error === 'string') {
      const e = new Error(data.error) as HelperError;
      if (data.host_key_changed) {
        e.hostKeyChanged = true;
        e.hostKey = data.host_key;
      }
      throw e;
    }
    if (!Array.isArray(data?.results)) throw new Error('The helper gave no answer.');
    return { hostKey: String(data.host_key ?? ''), results: data.results };
  }
}
