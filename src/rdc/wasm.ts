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
  addEnv(input: EnvInput): unknown;
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
