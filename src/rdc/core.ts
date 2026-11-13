// The rdc app's pure core: what the Console hands rdc for an org, and how a prompt is answered.
// No DOM, no network, no wasm — the component does the I/O.
import { currentOrg } from '../rossum/orgName.js';
import type { EnvInput, Prompt } from './wasm.js';

// rdc's `api_base` is the API root, `https://<host>/api/v1` (rdc's config tests), and the
// Console's domain is the Rossum tab's `location.origin` — the extension calls
// `${domain}/api/v1/...` everywhere. null for anything that is not an http(s) origin.
export function apiBaseOf(domain: string): string | null {
  let url: URL;
  try {
    url = new URL(domain);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return `${url.origin}/api/v1`;
}

// The env for the connected session: the organization is the ONE that `GET /organizations`
// lists (`currentOrg`, the same rule as the Console's org name and CIB deploy). Anything
// else is an error string, since which organization to pull cannot be told.
export function envInputFor(
  domain: string,
  token: string,
  organizations: unknown,
  name: string,
): EnvInput | string {
  const apiBase = apiBaseOf(domain);
  if (!apiBase) return `Not a Rossum URL: ${domain}`;
  if (!token) return 'No session token.';
  const org = currentOrg(organizations);
  if (!org || org.id === null)
    return 'The session does not list exactly one organization, so which one to pull is unknown.';
  return { name, apiBase, orgId: org.id, authKind: 'token', token };
}

// rdc counts any answer that is not one of the prompt's choices as "no answer"; say so here
// too, so the UI never sends a key rdc would silently drop.
export function answerFor(prompt: Prompt, key: string | null): string | null {
  return key !== null && prompt.choices.some((c) => c.key === key) ? key : null;
}

// rdc's messages that need saying in the page's words, matched on rdc's own phrases (rdc
// `wasm/src/lib.rs`, `src/state/data_storage_store.rs`, `src/cli/sync/recover.rs`). null for any
// other message, which the page shows as rdc wrote it.
const RUN_ERRORS: [string, string][] = [
  [
    'already being synced in another tab',
    'Another tab of this browser is reading or deploying this org. Finish or close it, then retry.',
  ],
  [
    'Web Locks are not available in this context',
    'This browser cannot lock the org while rdc works, so rdc did not start.',
  ],
  [
    'was changed by another run',
    'Someone else ran rdc on this org at the same time. This run stopped; read both orgs again.',
  ],
  [
    'loading the sync state of env',
    "rdc could not load its sync state from the org's Data Storage, so it did not start.",
  ],
  [
    "an unfinished run's create may have made any of",
    'A deployment stopped in the middle, and rdc cannot tell which of several objects it created. Delete the extra ones, then retry.',
  ],
];

export function runErrorFor(message: string): string | null {
  return RUN_ERRORS.find(([phrase]) => message.includes(phrase))?.[1] ?? null;
}

export type TreeChange = { path: string; change: 'added' | 'changed' | 'removed' };

// Not configuration read from the org: rdc's generated index pages and the env's own values.
const notRemote = (path: string) =>
  /(^|\/)_index\.md$/.test(path) || /^envs\/[^/]+\/overlay\.toml$/.test(path);

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// What changed under `envs/<env>/` between two snapshots of the project tree, per file.
export function diffEnvTree(
  before: Map<string, Uint8Array>,
  after: Map<string, Uint8Array>,
  env: string,
): TreeChange[] {
  const prefix = `envs/${env}/`;
  const paths = new Set([...before.keys(), ...after.keys()]);
  const out: TreeChange[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix) || notRemote(path)) continue;
    const a = before.get(path);
    const b = after.get(path);
    if (!a && b) out.push({ path, change: 'added' });
    else if (a && !b) out.push({ path, change: 'removed' });
    else if (a && b && !same(a, b)) out.push({ path, change: 'changed' });
  }
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

// No stored tree for `env` yet: the files a new project scaffolds (`overlay.toml`, `_index.md`)
// do not count, so a first read stores the baseline instead of listing every object as edited.
export function isFirstRead(before: Map<string, Uint8Array>, env: string): boolean {
  return diffEnvTree(new Map(), before, env).length === 0;
}
