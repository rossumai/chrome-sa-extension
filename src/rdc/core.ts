// The rdc proof of concept's pure core: what the Console hands rdc, and how rdc's in-memory
// tree is shown. No DOM, no network, no wasm — the component does the I/O.
import { currentOrg } from '../rossum/orgName.js';
import type { EnvInput, Prompt } from './wasm.js';

// The one env the in-memory project holds. rdc allows letters, digits, `-` and `_`.
export const ENV = 'org';

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
): EnvInput | string {
  const apiBase = apiBaseOf(domain);
  if (!apiBase) return `Not a Rossum URL: ${domain}`;
  if (!token) return 'No session token.';
  const org = currentOrg(organizations);
  if (!org || org.id === null)
    return 'The session does not list exactly one organization, so which one to pull is unknown.';
  return { name: ENV, apiBase, orgId: org.id, authKind: 'token', token };
}

// rdc counts any answer that is not one of the prompt's choices as "no answer"; say so here
// too, so the UI never sends a key rdc would silently drop.
export function answerFor(prompt: Prompt, key: string | null): string | null {
  return key !== null && prompt.choices.some((c) => c.key === key) ? key : null;
}

export type TreeRow = { key: string; depth: number; name: string; dir: boolean; size?: number };

// The project's flat `path -> bytes` map as an indented tree: each directory once, before
// its contents, everything in path order.
export function treeRows(files: Map<string, Uint8Array>): TreeRow[] {
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  for (const path of [...files.keys()].sort()) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/') + '/';
      if (seen.has(dir)) continue;
      seen.add(dir);
      rows.push({ key: dir, depth: i, name: parts[i], dir: true });
    }
    rows.push({
      key: path,
      depth: parts.length - 1,
      name: parts[parts.length - 1],
      dir: false,
      size: files.get(path)!.length,
    });
  }
  return rows;
}
