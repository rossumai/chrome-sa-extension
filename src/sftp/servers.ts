// src/sftp/servers.ts
// A saved SFTP server IS a helper hook in the org: a function hook, active, subscribed to
// `invocation.manual` only (so Rossum never runs it on a document), attached to no queue. Its
// `settings` hold the address and the pinned host key; its `secrets` hold the password or the
// private key. Rossum never returns secrets (GET answers `secrets: null`) and PATCH merges them
// (measured 2026-11-19), so nobody can read a saved password back — but anyone who can invoke
// the hook can use it. Pure: no network here.
import { HELPER_CODE } from './helperCode.js';

/** Marks a hook as one of ours, in its settings; the one test `serverFromHook` applies. */
const MARKER = 'sa-extension-sftp';

export type AuthKind = 'password' | 'key';

export type Server = {
  hookId: number;
  hookUrl: string;
  host: string;
  port: number;
  user: string;
  auth: AuthKind;
  /** `ssh-ed25519 SHA256:…`, pinned on the first open; null until then. */
  hostKey: string | null;
  /** The helper's code is older than this build's; the next open replaces it. */
  stale: boolean;
  /** The hook as listed, for a PATCH that must send whole objects back. */
  raw: any;
};

export type ServerInput = {
  host: string;
  port: number;
  user: string;
  auth: AuthKind;
  /** The password or the private key. Empty on an edit means "keep the saved one". */
  secret: string;
};

export function addressOf(s: { host: string; port: number; user: string }): string {
  return `${s.user}@${s.host}:${s.port}`;
}

// A raw Rossum hook object, untyped on the wire.
export function serverFromHook(hook: any): Server | null {
  const s = hook?.settings;
  if (hook?.type !== 'function' || s?.kind !== MARKER) return null;
  if (typeof s.host !== 'string' || typeof s.user !== 'string') return null;
  const port = Number(s.port);
  if (!Number.isInteger(port) || port <= 0) return null;
  return {
    hookId: hook.id,
    hookUrl: hook.url,
    host: s.host,
    port,
    user: s.user,
    auth: s.auth === 'key' ? 'key' : 'password',
    hostKey: typeof s.host_key === 'string' && s.host_key ? s.host_key : null,
    stale:
      hook.config?.code !== HELPER_CODE || hook.config?.third_party_library_pack !== LIBRARY_PACK,
    raw: hook,
  };
}

function settingsOf(input: Omit<ServerInput, 'secret'>, hostKey: string | null) {
  const settings: Record<string, unknown> = {
    kind: MARKER,
    host: input.host,
    port: input.port,
    user: input.user,
    auth: input.auth,
  };
  if (hostKey) settings.host_key = hostKey;
  return settings;
}

function secretsOf(auth: AuthKind, secret: string) {
  return auth === 'key' ? { private_key: secret } : { password: secret };
}

const nameOf = (input: { host: string; port: number; user: string }) =>
  `SFTP ${addressOf(input)} (SA extension)`;

// Rossum's library pack with paramiko in it; the default pack has no SSH library.
const LIBRARY_PACK = 'professional_services';

const CONFIG = () => ({
  runtime: 'python3.12',
  third_party_library_pack: LIBRARY_PACK,
  code: HELPER_CODE,
});

// What a reader of the org's extensions list sees: what this hook is, and how to get rid of it.
function descriptionOf(input: { host: string; port: number; user: string; auth: AuthKind }) {
  const what = input.auth === 'key' ? 'private key' : 'password';
  return (
    `Created by the Rossum SA extension's Console (SFTP app). It connects to ` +
    `${addressOf(input)} over SFTP when someone browses that server in the Console, and only ` +
    `then: it runs on manual invocation only, on no queue and no document. The ${what} is ` +
    `kept in this hook's secrets and cannot be read back. Remove the server in the Console, ` +
    `or delete this hook, to forget it.`
  );
}

export function createBody(input: ServerInput) {
  return {
    type: 'function',
    name: nameOf(input),
    description: descriptionOf(input),
    queues: [],
    events: ['invocation.manual'],
    active: true,
    settings: settingsOf(input, null),
    secrets: secretsOf(input.auth, input.secret),
    config: CONFIG(),
  };
}

// The PATCH for an edit. A changed host or port drops the pinned host key: the next open pins
// the new server's. Secrets are merged by Rossum, so only a typed secret is sent.
export function editBody(server: Server, input: ServerInput) {
  const sameEndpoint = server.host === input.host && server.port === input.port;
  const body: Record<string, unknown> = {
    name: nameOf(input),
    description: descriptionOf(input),
    settings: settingsOf(input, sameEndpoint ? server.hostKey : null),
    config: CONFIG(),
  };
  if (input.secret) body.secrets = secretsOf(input.auth, input.secret);
  return body;
}

// The PATCH that pins a host key after the first open, or refreshes stale helper code (and
// its description) before the next call.
export function pinBody(server: Server, hostKey: string | null) {
  return {
    description: descriptionOf(server),
    settings: settingsOf(server, hostKey ?? server.hostKey),
    config: CONFIG(),
  };
}
