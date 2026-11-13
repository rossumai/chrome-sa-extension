// Loads rdc's wasm at run time, from the OPTIONAL dependency @mrtnzlml/rdc-wasm, which
// build.js copies to dist/console/rdc/ when it is installed (it needs a GitHub Packages token,
// so most builds, the Web Store release included, do not have it).
//
// The glue is NOT bundled, so `npm run typecheck`, `npm test` and the build all work without
// the package: it is imported from the extension's own URL — a dynamic `import()` of a
// variable, which esbuild leaves untouched in the iife bundle — and the types below are a
// hand-kept subset of the package's `rdc_wasm.d.ts`, which is the source of truth. The module
// is initialised with an explicit URL rather than the glue's `import.meta.url` default.

export type AuthKind = 'token' | 'password';
export interface EnvInput {
  name: string;
  apiBase: string;
  orgId: number;
  authKind: AuthKind;
  token?: string | null;
  username?: string | null;
  password?: string | null;
}
export interface SyncOptions {
  interactive?: boolean;
  allowDeletes?: boolean;
  noPush?: boolean;
  noPull?: boolean;
  dryRun?: boolean;
  conflict?: 'useRemote' | 'keepLocal' | 'skip' | null;
}
export type PromptKind =
  | 'conflict'
  | 'remoteDelete'
  | 'bulkConfirm'
  | 'deleteGate'
  | 'deleteDrift'
  | 'mdhIndexDrop'
  | 'mdhRowDelete'
  | 'recoverCreate'
  | 'unknown';
export interface Prompt {
  kind: PromptKind;
  question: string;
  choices: { key: string; label: string }[];
}
// A dry run's plan, and what a run left unwritten (rdc `feat/wasm-migrate` spec §7).
export type PlanDirection = 'push' | 'pull' | 'both';
export type PlanChange = 'create' | 'update' | 'delete' | 'conflict';
export type PlanPrompt = 'deleteGate' | 'conflict' | 'remoteDelete';
export interface PlanItem {
  kind: string;
  slug: string;
  direction: PlanDirection;
  change: PlanChange;
  prompt: PlanPrompt | null;
  note: string | null;
}
export interface PlanRecovery {
  kind: string;
  slug: string;
  id: number | null;
}
export interface SyncPlan {
  items: PlanItem[];
  recovered: PlanRecovery[];
  problems: string[];
}
export type SkipReason =
  | 'deleteGateDeclined'
  | 'deleteDriftSkipped'
  | 'pushDriftSkipped'
  | 'conflictSkipped'
  | 'remoteDeleteSkipped'
  | 'mdhIndexDropDeclined'
  | 'mdhRowDeleteDeclined';
export interface SkippedItem {
  kind: string;
  slug: string;
  reason: SkipReason;
}
export interface CycleOutcome {
  itemsPushed: number;
  itemsPulled: number;
  conflicts: number;
  remoteDeletesResolved: number;
  fileCount: number;
  // Set only by a dry run. Absent in builds before rdc's dry-run plan.
  plan?: SyncPlan | null;
  // What this cycle did not write, and why. Absent in builds before it.
  skipped?: SkippedItem[];
}
// Where rdc keeps each env's sync state: the host's store (`stateStore.ts`). `save` is a
// compare-and-swap: false when the stored rev is not `expectedRev` (null: nothing stored yet).
export interface StoredState {
  rev: number;
  snapshot: Uint8Array;
}
export interface StateStore {
  load(env: string): Promise<StoredState | null>;
  save(
    env: string,
    snapshot: Uint8Array,
    expectedRev: number | null,
    nextRev: number,
  ): Promise<boolean>;
}
// `migrate`, as rdc's `feat/wasm-migrate` spec (2026-11-03) fixes it.
export type CarryGroup = 'scoreThresholds' | 'emailPrefixes' | 'automation' | 'all';
export interface MigrateOptions {
  dryRun?: boolean;
  mirror?: boolean;
  allowRecreate?: boolean;
  only?: string[];
  carry?: CarryGroup[];
}
export type FileChange = 'create' | 'update' | 'unchanged';
export type ObjectChange = 'create' | 'update' | 'unchanged' | 'delete';
export interface MigrateFile {
  source: string;
  target: string;
  change: FileChange;
  // The object the file belongs to, as `PlanItem` and `SkippedItem` name it; null for a file
  // that is no object (`overlay.toml`, `_index.md`, docs).
  kind: string | null;
  slug: string | null;
}
export interface MigrateObject {
  kind: string;
  slug: string;
  change: ObjectChange;
}
// A target file `mirror` removed, with its object's identity as for `MigrateFile`.
export interface MigratePruned {
  target: string;
  kind: string | null;
  slug: string | null;
}
export interface MigrateResult {
  dryRun: boolean;
  source: string;
  target: string;
  files: MigrateFile[];
  objects: MigrateObject[];
  pruned: MigratePruned[];
  prunedDirs: string[];
  skipped: string[];
  warnings: string[];
  creates: number;
  updates: number;
  unchanged: number;
  deletes: number;
  filesChanged: number;
  renamed: number;
}
export interface RdcProject {
  files(): Map<string, Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): void;
  deleteFile(path: string): void;
  addEnv(input: EnvInput): unknown;
  // Optional: builds before rdc's migrate in the browser do not have it, and the page checks.
  migrate?(
    src: string,
    tgt: string,
    opts: MigrateOptions | null | undefined,
    onLog: (line: string) => void,
  ): Promise<MigrateResult>;
  // Optional: rdc builds before the host-side state store do not have it, and the page checks.
  useStateStore?(store: StateStore): void;
  sync(
    env: string,
    opts: SyncOptions,
    onPrompt: (p: Prompt) => Promise<string | null>,
    onLog: (line: string) => void,
  ): Promise<CycleOutcome>;
  free(): void;
}
export interface Rdc {
  version(): string;
  Project: {
    create(name: string, firstEnv: EnvInput): RdcProject;
    // An existing project, from its files.
    new (files: Map<string, Uint8Array>): RdcProject;
  };
}

const RDC_GLUE_PATH = 'console/rdc/rdc_wasm.js';
const RDC_WASM_PATH = 'console/rdc/rdc_wasm_bg.wasm';

// A glue that cannot be imported means this build was made without the package.
export async function loadRdc(): Promise<Rdc> {
  let glue: any;
  try {
    glue = await import(chrome.runtime.getURL(RDC_GLUE_PATH));
  } catch {
    throw new Error(
      `${RDC_GLUE_PATH} is not in this build — install @mrtnzlml/rdc-wasm (see CLAUDE.md) and rebuild`,
    );
  }
  await glue.default({ module_or_path: chrome.runtime.getURL(RDC_WASM_PATH) });
  return glue as Rdc;
}
