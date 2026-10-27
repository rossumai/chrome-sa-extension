// The rdc deployments page's pure core: the steps, the object kinds it counts, the source env it
// hands rdc, and why each unfinished feature is unavailable. No DOM, no network, no wasm.
import type { EnvInput } from './wasm.js';
import { apiBaseOf } from './core.js';

// rdc env names; what the admin sees (the org's name) is separate.
export const SOURCE_ENV = 'source';
export const TARGET_ENV = 'target';

export type Kind = 'queues' | 'schemas' | 'hooks' | 'rules' | 'labels';

export const KINDS: { kind: Kind; label: string; icon: string }[] = [
  { kind: 'queues', label: 'Queues', icon: 'i-queue' },
  { kind: 'schemas', label: 'Schemas', icon: 'i-schema' },
  { kind: 'hooks', label: 'Hooks', icon: 'i-hook' },
  { kind: 'rules', label: 'Rules', icon: 'i-rule' },
  { kind: 'labels', label: 'Labels', icon: 'i-label' },
];

export type StepId = 'connect' | 'read' | 'plan' | 'review' | 'write';

// The band shows the last step as `Write to <target name>`.
export const STEPS: { id: StepId; label: string }[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'read', label: 'Read both' },
  { id: 'plan', label: 'Plan' },
  { id: 'review', label: 'Review' },
  { id: 'write', label: 'Write' },
];

// One object per JSON file in rdc's layout under `envs/<env>/`: a queue and its schema sit in
// `.../queues/<q>/queue.json` and `schema.json`; hooks, rules and labels sit directly under the
// env root. Sidecar files (`.py`, formulas) are not objects.
export function countKinds(files: Map<string, Uint8Array>, env: string): Record<Kind, number> {
  const counts: Record<Kind, number> = { queues: 0, schemas: 0, hooks: 0, rules: 0, labels: 0 };
  const prefix = `envs/${env}/`;
  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (/(^|\/)queues\/[^/]+\/queue\.json$/.test(rest)) counts.queues++;
    else if (/(^|\/)queues\/[^/]+\/schema\.json$/.test(rest)) counts.schemas++;
    else {
      const m = /^(hooks|rules|labels)\/[^/]+\.json$/.exec(rest);
      if (m) counts[m[1] as Kind]++;
    }
  }
  return counts;
}

export type Source = { name: string; domain: string; orgId: number; orgName: string };

// The host of an org's address, for display. A malformed address is shown as it is.
export function hostOf(domain: string): string {
  try {
    return new URL(domain).host;
  } catch {
    return domain;
  }
}

export function sourceEnvInput(source: Source, token: string): EnvInput | string {
  const apiBase = apiBaseOf(source.domain);
  if (!apiBase) return `Not a Rossum URL: ${source.domain}`;
  if (!token) return `Give a token for ${source.name}.`;
  return {
    name: SOURCE_ENV,
    apiBase,
    orgId: source.orgId,
    authKind: 'token',
    token,
  };
}

// The organizations a token can read, from `GET /organizations`. An entry without a numeric id
// is skipped; a missing name falls back to `org <id>`. Junk gives an empty list.
export function readableOrgs(organizations: unknown): { id: number; name: string }[] {
  const results = (organizations as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: { id: number; name: string }[] = [];
  for (const o of results) {
    if (typeof o?.id !== 'number') continue;
    out.push({ id: o.id, name: typeof o.name === 'string' && o.name ? o.name : `org ${o.id}` });
  }
  return out;
}

export type WipFeature = 'history' | 'secrets' | 'plan' | 'review' | 'write' | 'ownValues';

// Why each unfinished feature is unavailable; shown instead of any invented data.
export const WIP: Record<WipFeature, string> = {
  history: 'Not available yet. Deployments are not recorded until rdc can store them in this org.',
  secrets:
    'Not available yet. Which hooks need a secret is known only after the plan, and rdc cannot plan in the browser yet.',
  plan: 'Not available yet. Planning needs rdc migrate in the browser build, which is in progress.',
  review:
    "Not available yet. Reviewing needs rdc's list of changes and conflicts, which is in progress.",
  write:
    'Not available yet. Nothing can be written to this org from here; writing waits for the plan and the review.',
  ownValues:
    'Not available yet. Own values are stored with the project, which rdc cannot do in the browser yet.',
};
