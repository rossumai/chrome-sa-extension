// Loads rdc's wasm (the release pinned in rdc-wasm.json, which build.js downloads into
// vendor/rdc/ and copies to dist/console/rdc/) at run time.
//
// The glue is NOT bundled: vendor/rdc/ exists only once a build has run, and `npm run
// typecheck` and `npm test` run on a fresh clone before any build (CI typechecks first). So it
// is imported from the extension's own URL — a dynamic `import()` of a variable, which
// esbuild leaves untouched in the iife bundle — and the types below are a hand-kept subset of the generated `rdc_wasm.d.ts`, which is the
// source of truth. The module is initialised with an explicit URL rather than the glue's
// `import.meta.url` default.

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
export interface Prompt {
  kind: string;
  question: string;
  choices: { key: string; label: string }[];
}
export interface CycleOutcome {
  itemsPushed: number;
  itemsPulled: number;
  conflicts: number;
  remoteDeletesResolved: number;
  fileCount: number;
}
export interface RdcProject {
  files(): Map<string, Uint8Array>;
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
  Project: { create(name: string, firstEnv: EnvInput): RdcProject };
}

const RDC_GLUE_PATH = 'console/rdc/rdc_wasm.js';
const RDC_WASM_PATH = 'console/rdc/rdc_wasm_bg.wasm';

// Every build ships the wasm (build.js fails without it), so a glue that cannot be imported
// means a broken dist/ — said plainly, like any other load failure (CSP refusal, corrupt file).
export async function loadRdc(): Promise<Rdc> {
  let glue: any;
  try {
    glue = await import(chrome.runtime.getURL(RDC_GLUE_PATH));
  } catch {
    throw new Error(`${RDC_GLUE_PATH} is missing from this build — run \`npm run build\` again`);
  }
  await glue.default({ module_or_path: chrome.runtime.getURL(RDC_WASM_PATH) });
  return glue as Rdc;
}
