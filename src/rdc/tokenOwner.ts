// Which target-org user owns the hooks' tokens. rdc never carries a hook's `token_owner` across
// envs (a user URL of the source org means nothing in the target; rdc `src/snapshot/create.rs`),
// and its store-extension install (`POST /hooks/create`, rdc
// `src/cli/deploy/store_extensions.rs` `build_install_body`) refuses a hook without one. rdc's
// answer is the target's `[hooks."*"] token_owner` in `envs/<target>/overlay.toml`, which
// `migrate` writes into every hook it copies. The page writes that one key, line by line, and
// leaves the rest of the file as it is.
import { TARGET_ENV } from './deploy.js';
import type { MigrateResult, SyncPlan } from './wasm.js';

export const OVERLAY_PATH = `envs/${TARGET_ENV}/overlay.toml`;

const WILDCARD = /^\s*\[\s*hooks\s*\.\s*"\*"\s*\]\s*(#.*)?$/;
const HEADER = /^\s*\[/;
const KEY = /^\s*token_owner\s*=\s*"((?:[^"\\]|\\.)*)"\s*(#.*)?$/;

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const unquote = (s: string) => s.replace(/\\(["\\])/g, '$1');

// The `[hooks."*"]` table: its header line, and the end of its body (the next table, or EOF).
function wildcardTable(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => WILDCARD.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !HEADER.test(lines[end])) end++;
  return { start, end };
}

export function readHookTokenOwner(toml: string): string | null {
  const lines = toml.split('\n');
  const t = wildcardTable(lines);
  if (!t) return null;
  for (let i = t.start + 1; i < t.end; i++) {
    const m = KEY.exec(lines[i]);
    if (m) return unquote(m[1]);
  }
  return null;
}

export function setHookTokenOwner(toml: string, userUrl: string): string {
  const line = `token_owner = ${quote(userUrl)}`;
  const lines = toml.split('\n');
  const t = wildcardTable(lines);
  if (!t) return `${toml}${toml.endsWith('\n') ? '' : '\n'}\n[hooks."*"]\n${line}\n`;
  for (let i = t.start + 1; i < t.end; i++)
    if (KEY.test(lines[i])) {
      lines[i] = line;
      return lines.join('\n');
    }
  lines.splice(t.start + 1, 0, line);
  return lines.join('\n');
}

// The store-extension hooks the plan creates in the target: each needs a `token_owner`.
// Only a create: the PATCH of an existing hook sends no install body.
export function storeHookCreates(
  result: MigrateResult,
  plan: SyncPlan,
  files: Map<string, Uint8Array>,
): string[] {
  const out: string[] = [];
  for (const i of plan.items) {
    if (i.kind !== 'hooks' || i.change !== 'create' || i.direction === 'pull') continue;
    const f = result.files.find(
      (x) => x.kind === 'hooks' && x.slug === i.slug && x.target.endsWith('.json'),
    );
    const bytes = f && files.get(f.target);
    if (!bytes) continue;
    try {
      if (JSON.parse(new TextDecoder().decode(bytes))?.extension_source === 'rossum_store')
        out.push(i.slug);
    } catch {
      // not JSON: not a hook body rdc could install
    }
  }
  return out.sort();
}
