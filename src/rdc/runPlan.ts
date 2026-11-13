// Plan's run on a scratch copy of the read's project (`new Project(files)`, no state store, so
// nothing is saved): the hooks' token owner into the target overlay, the migrate for real, then a
// dry-run sync of the target, whose plan is what Write would send. Write applies the same owner
// to the read's project the same way (`writeTokenOwner`), before its own migrate.
import { SOURCE_ENV, TARGET_ENV } from './deploy.js';
import { migrateOptions, type PlanChoice, type Planned } from './plan.js';
import { tracked } from './runs.js';
import { OVERLAY_PATH, setHookTokenOwner, storeHookCreates } from './tokenOwner.js';
import type { RdcProject } from './wasm.js';

// rdc's overlay must carry `version` (it has no default), so an absent file starts with it.
export function writeTokenOwner(project: RdcProject, userUrl: string | null): void {
  if (!userUrl) return;
  const raw = project.files().get(OVERLAY_PATH);
  const current = raw ? new TextDecoder().decode(raw) : 'version = 1\n';
  project.writeFile(OVERLAY_PATH, new TextEncoder().encode(setHookTokenOwner(current, userUrl)));
}

export async function runPlan(
  copy: () => RdcProject,
  choice: PlanChoice,
  tokenOwner: string | null,
  onLog: (line: string) => void,
): Promise<Planned> {
  const scratch = copy();
  try {
    writeTokenOwner(scratch, tokenOwner);
    const result = await tracked(
      scratch.migrate!(SOURCE_ENV, TARGET_ENV, migrateOptions(choice, false), onLog),
    );
    // What Write's sync would do after this migrate; asks nothing, writes nothing.
    const log: string[] = [];
    const out = await tracked(
      scratch.sync(
        TARGET_ENV,
        { dryRun: true, interactive: false },
        async () => null,
        (l) => void log.push(l),
      ),
    );
    if (!out.plan) throw new Error('This build of rdc returns no dry-run plan.');
    return {
      result,
      plan: out.plan,
      log,
      storeHooks: storeHookCreates(result, out.plan, scratch.files()),
      tokenOwner,
    };
  } finally {
    scratch.free();
  }
}
