// The deployment's pure core between the read and the write: rdc migrate's options from the Plan
// step, and the Review list from its result. No DOM, no network, no wasm.
import type {
  CarryGroup,
  MigrateOptions,
  MigrateResult,
  PlanItem,
  SkippedItem,
  SyncPlan,
} from './wasm.js';

// rdc's slug mapping between the envs; the page keeps it (`sourceStore.ts`).
export const MAPPING_PATH = '.rdc/mapping.toml';

export function readMapping(files: Map<string, Uint8Array>): string | null {
  const b = files.get(MAPPING_PATH);
  return b ? new TextDecoder().decode(b) : null;
}

// A plan: the migrate, and rdc's dry-run plan of the target sync that Write would run after it,
// both made on a scratch copy of the project (`Plan.tsx`), plus that dry run's log, kept for the
// admin to read.
export type Planned = {
  result: MigrateResult;
  plan: SyncPlan;
  log: string[];
  // Store-extension hooks the plan creates: each needs a token owner in the target.
  storeHooks: string[];
  // The hooks' token owner the plan was made with, or null.
  tokenOwner: string | null;
};

// Write needs the token owner when the plan creates a store-extension hook, and the plan must
// have been made with the owner Write will apply.
export function tokenOwnerMissing(planned: Planned, tokenOwner: string | null): boolean {
  return planned.storeHooks.length > 0 && (!tokenOwner || planned.tokenOwner !== tokenOwner);
}

export type PlanChoice = {
  // "Things the target has and the source does not": delete them.
  mirror: boolean;
  // "Also overwrite the target's own": rdc migrate's `--carry` groups.
  carry: Record<Exclude<CarryGroup, 'all'>, boolean>;
};

export const DEFAULT_PLAN: PlanChoice = {
  mirror: false,
  carry: { scoreThresholds: false, emailPrefixes: false, automation: false },
};

export function migrateOptions(choice: PlanChoice, dryRun: boolean): MigrateOptions {
  const carry = (Object.keys(choice.carry) as Exclude<CarryGroup, 'all'>[]).filter(
    (g) => choice.carry[g],
  );
  return { dryRun, mirror: choice.mirror, carry };
}

export type WriteList = Record<'create' | 'update' | 'delete' | 'conflict' | 'pull', PlanItem[]>;

// What Write sends to the org, by change, from rdc's dry-run plan; pulls (changes read back
// from the org) apart. A conflict goes both ways and is listed with what is sent.
export function writeList(plan: SyncPlan): WriteList {
  const out: WriteList = { create: [], update: [], delete: [], conflict: [], pull: [] };
  for (const i of plan.items) {
    if (i.direction === 'pull') out.pull.push(i);
    else out[i.change].push(i);
  }
  return out;
}

const idKey = (o: { kind: string; slug: string }) => `${o.kind}/${o.slug}`;

// The objects Write's sync sends, as `kind/slug`, from rdc's dry-run plan.
function sentObjects(plan: SyncPlan): Set<string> {
  return new Set(plan.items.filter((i) => i.direction !== 'pull').map(idKey));
}

// A target file's object as rdc names it (the identity `PlanItem` and `SkippedItem` use), from the
// migrate's files and pruned files: `null` for a file that is no object (`overlay.toml`,
// `_index.md`, docs), `undefined` for a file the migrate did not consider.
function identityOf(result: MigrateResult, path: string): string | null | undefined {
  const f =
    result.files.find((x) => x.target === path) ?? result.pruned.find((x) => x.target === path);
  if (!f) return undefined;
  return f.kind !== null && f.slug !== null ? `${f.kind}/${f.slug}` : null;
}

// The direct edits this deployment overwrites (or deletes): each object once, by rdc's identity,
// when Write sends it.
export function overwrittenEdits(
  result: MigrateResult,
  plan: SyncPlan,
  directEdits: string[],
): string[] {
  const sent = sentObjects(plan);
  const objects = new Set<string>();
  for (const path of directEdits) {
    const id = identityOf(result, path);
    if (id && sent.has(id)) objects.add(id);
  }
  return [...objects].sort();
}

// The direct edits still to warn about after a write: an object Write sent and rdc did not
// report skipped was overwritten (or deleted), so its warning goes; a file that is no object goes
// too. A file the migrate did not consider keeps its warning: nothing says it was written.
export function remainingAfterWrite(
  directEdits: string[],
  result: MigrateResult,
  plan: SyncPlan,
  skipped: SkippedItem[],
): string[] {
  const written = sentObjects(plan);
  for (const s of skipped) written.delete(idKey(s));
  return directEdits
    .filter((path) => {
      const id = identityOf(result, path);
      if (id === null) return false;
      return !(id && written.has(id));
    })
    .sort();
}
