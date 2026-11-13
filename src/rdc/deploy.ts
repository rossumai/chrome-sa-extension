// The rdc deployments page's pure core: the steps, the object kinds it counts, the source env it
// hands rdc, and why each unfinished feature is unavailable. No DOM, no network, no wasm.
import type { EnvInput, RdcProject } from './wasm.js';
import { apiBaseOf } from './core.js';
import { HIDDEN_PREFIX } from '../mdh/hiddenCollections.js';
import { dataStorageStateStore } from './stateStore.js';
import type { DataStorage } from './sourceStore.js';

// rdc env names; what the admin sees (the org's name) is separate. They are part of the stored
// sync state's identity (`<key>/<env>`), so renaming one orphans that env's state in every org.
export const SOURCE_ENV = 'source';
export const TARGET_ENV = 'target';

// Where rdc keeps each env's sync state, in that env's own org; the prefix hides it in Dataset
// Management.
export const STATE_COLLECTION = `${HIDDEN_PREFIX}rdc_state`;

// The state key: one deployment project per target org. The source's state is kept in the
// source org under the same key, so a source feeding several targets keeps one state per target.
export function stateKeyFor(targetOrgId: number): string {
  if (!Number.isInteger(targetOrgId)) throw new Error(`Not an organization id: ${targetOrgId}`);
  return `chrome-sa-extension/rdc-deployments/${targetOrgId}`;
}

// From the next run on, rdc keeps each env's sync state and tree in that env's own org, through
// the page's store (`stateStore.ts`): the source's with the source token, the target's with the
// session. false when this rdc build has no `useStateStore`; the project then stays in memory,
// and nothing may be written.
export function keepStateInOrgs(
  project: RdcProject,
  orgs: { source: DataStorage; target: DataStorage },
  targetOrgId: number,
): boolean {
  if (typeof project.useStateStore !== 'function') return false;
  project.useStateStore(
    dataStorageStateStore(
      { [SOURCE_ENV]: orgs.source, [TARGET_ENV]: orgs.target },
      stateKeyFor(targetOrgId),
    ),
  );
  return true;
}

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

export type WipFeature = 'history' | 'secrets' | 'plan' | 'review' | 'ownValues';

// Why each unfinished feature is unavailable; shown instead of any invented data.
export const WIP: Record<WipFeature, string> = {
  history: 'Not available yet. Deployments are not recorded until rdc can store them in this org.',
  secrets:
    'Not available yet. Hook secrets are not sent from here: an existing hook keeps its secrets, and a new hook is created without them.',
  plan: 'Not available yet. Picking single objects is in progress; a plan brings everything.',
  review:
    'Not available yet. Line-by-line changes are in progress; Review lists the objects that change.',
  ownValues:
    'Not available yet. Own values are stored with the project, which rdc cannot do in the browser yet.',
};
