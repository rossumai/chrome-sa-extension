// src/cib/release.ts
// Reads a CIB release from GitHub at deploy time and compiles it into the engine's create plan.
// Nothing of CIB is bundled with the extension: the objects come from the public release repo, the
// deploy settings (cib_target.yaml, hooks.csv, required_scopes.json) from the release's deploy/
// folder or, for v1.x which have none, from the official deploy tool's _config/ (the same fallback
// as its cib_assets.resolve_assets). Both hosts answer with Access-Control-Allow-Origin: *.
// Release files and API objects are raw JSON, hence the `any`s.
import type { Progress } from './engine.js';
import { readRequiredScopes } from './cib.js';

export const CIB_REPO = 'rossumai/rossum-coupa-integration';
export const TOOL_REPO = 'rossumai/coupa-integration-deploy-tool';
// deploy tool tags whose _config/ the extension supports; v1.3.4's "only covers v1.0.0 and v1.1.0"
export const TOOL_REFS = ['v1.3.4'];
export const TOOL_REF = TOOL_REFS[0];

const api = (path: string) => `https://api.github.com/repos/${path}`;
const raw = (repo: string, ref: string, path: string) =>
  `https://raw.githubusercontent.com/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function get(f: typeof fetch, url: string): Promise<string> {
  const r = await f(url);
  if (!r.ok)
    throw new Error(
      `GitHub answered ${r.status} for ${url}` +
        (r.status === 403 || r.status === 429
          ? ' (without sign-in the GitHub API allows 60 calls per hour; try again later)'
          : ''),
    );
  return r.text();
}

// published releases, newest first
export const listReleases = async (f: typeof fetch = fetch): Promise<string[]> =>
  JSON.parse(await get(f, api(`${CIB_REPO}/releases?per_page=100`)))
    .filter((r: any) => !r.draft && !r.prerelease)
    .map((r: any) => r.tag_name);

// the files of a prd2 org folder (paths relative to it) that make up the plan
const WANTED = [
  /^engines\/[^/]+\/engine\.json$/,
  /^engines\/[^/]+\/engine_fields\/[^/]+\.json$/,
  /^workspaces\/[^/]+\/workspace\.json$/,
  /^workspaces\/[^/]+\/queues\/[^/]+\/(queue|schema|inbox)\.json$/,
  /^hooks\/[^/]+\.json$/,
  /^rules\/[^/]+\.json$/,
];

export async function loadRelease(
  tag: string,
  {
    fetchImpl = fetch,
    onProgress = () => {},
    toolRef = TOOL_REF,
  }: { fetchImpl?: typeof fetch; onProgress?: (p: Progress) => void; toolRef?: string } = {},
) {
  if (!TOOL_REFS.includes(toolRef))
    throw new Error(`${toolRef} is not a supported deploy tool version (${TOOL_REFS.join(', ')})`);
  const f = fetchImpl;
  const tree = JSON.parse(
    await get(f, api(`${CIB_REPO}/git/trees/${encodeURIComponent(tag)}?recursive=1`)),
  );
  if (tree.truncated) throw new Error(`the GitHub file list of ${tag} is truncated`);
  const paths: string[] = tree.tree.filter((e: any) => e.type === 'blob').map((e: any) => e.path);
  const [repo, ref, dir] = paths.includes('deploy/hooks.csv')
    ? [CIB_REPO, tag, 'deploy']
    : [TOOL_REPO, toolRef, '_config'];
  const [yaml, hooksCsv, scopes] = await Promise.all(
    ['cib_target.yaml', 'hooks.csv', 'required_scopes.json'].map((n) =>
      get(f, raw(repo, ref, `${dir}/${n}`)),
    ),
  );
  // only two top-level keys are needed, so no YAML parser
  const key = (k: string) => yaml.match(new RegExp(`^${k}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
  const sourceUrl = key('source_url');
  if (!sourceUrl) throw new Error(`no source_url in ${dir}/cib_target.yaml`);
  let root = key('source_dir') ?? '';
  if (!paths.some((p) => p.startsWith(`${root}/`))) {
    // the tool's legacy yaml names cib/cib; v1.x trees hold the org folder as <org>/default
    const org = paths.find((p) => /^[^/]+\/organization\.json$/.test(p));
    if (!org) throw new Error(`${tag}: no organization folder found`);
    root = org.replace(/organization\.json$/, 'default');
  }
  const orgFile = root.replace(/[^/]+$/, 'organization.json');
  const rel = paths
    .filter((p) => p.startsWith(`${root}/`))
    .map((p) => p.slice(root.length + 1))
    .filter((p) => WANTED.some((re) => re.test(p)));
  const files = new Map<string, any>();
  let done = 0;
  const total = rel.length + 1;
  const next = [orgFile, ...rel.map((p) => `${root}/${p}`)];
  const worker = async () => {
    for (let p; (p = next.shift());) {
      files.set(
        p === orgFile ? '../organization.json' : p.slice(root.length + 1),
        JSON.parse(await get(f, raw(CIB_REPO, tag, p))),
      );
      onProgress({ phase: 'release', done: ++done, total, detail: `${CIB_REPO} ${tag}: ${p}` });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return {
    plan: compilePlan(files, { sourceUrl, release: tag }),
    hooksCsv,
    requiredScopes: readRequiredScopes(scopes),
    deployConfig: `${repo}@${ref}/${dir}`,
  };
}

// --- the compiler: a prd2 org folder -> create plan, OFFLINE --------------------------------------
// Ops: {key, type, body, match, template?}; strings "$org", "$token_owner", "$ref:<key>" are placeholders.
// Order: engines -> engine fields -> workspaces -> hooks (run_after first) -> per queue schema,
// queue, inbox -> rules; then "patches" (engine training_queues).
const DROP_ALL = ['id', 'url', 'created_at', 'created_by', 'modified_at', 'modified_by'];
const DROP: Record<string, string[]> = {
  engines: ['training_queues', 'agenda_id'],
  engine_fields: [],
  workspaces: ['queues'],
  hooks: ['status', 'guide', 'hook_template'],
  schemas: ['queues', 'rules'],
  queues: [
    'webhooks', // the API takes /webhooks/<id> urls only; queue.hooks carries the same list
    'inbox',
    'rules',
    'counts',
    'users',
    'training_enabled',
    'workflows',
    'dedicated_engine',
    'generic_engine',
    'status',
  ],
  inboxes: ['email'],
  rules: ['rule_template', 'synchronized_from_template'],
};
// a hook from a Store template gets its code from the template, so these stay out of the body
const PRIVATE_DROP = ['code', 'third_party_library_pack', 'runtime', 'private'];
const lastId = (u: string) => +u.replace(/\/+$/, '').split('/').pop()!;

// files: paths relative to the org folder (plus "../organization.json") -> parsed JSON
export function compilePlan(
  files: Map<string, any>,
  { sourceUrl, release }: { sourceUrl: string; release: string },
) {
  const src = sourceUrl.replace(/\/+$/, ''),
    host = src.match(/^https:\/\/[^/]+/)![0],
    orgUrl = `${src}/organizations/${files.get('../organization.json').id}`;
  const all = [...files.keys()].sort();
  const pick = (re: RegExp) => all.filter((p) => re.test(p)).map((p) => files.get(p));
  // folders sorted as folders ("a" before "a b"), as the Python compiler's sorted(glob(...))
  const dirs = (re: RegExp) =>
    all
      .filter((p) => re.test(p))
      .map((p) => p.replace(/\/[^/]+$/, ''))
      .sort();

  const engines = dirs(/^engines\/[^/]+\/engine\.json$/).map((d) => ({
    e: files.get(`${d}/engine.json`),
    fields: all.filter((p) => p.startsWith(`${d}/engine_fields/`)).map((p) => files.get(p)),
  }));
  const wss = dirs(/^workspaces\/[^/]+\/workspace\.json$/).map((d) =>
    files.get(`${d}/workspace.json`),
  );
  const queues = dirs(/^workspaces\/[^/]+\/queues\/[^/]+\/queue\.json$/).map((d) => ({
    q: files.get(`${d}/queue.json`),
    s: files.get(`${d}/schema.json`),
    i: files.get(`${d}/inbox.json`),
  }));
  const hooks = new Map<number, any>(pick(/^hooks\/[^/]+\.json$/).map((h) => [h.id, h]));
  const rules = pick(/^rules\/[^/]+\.json$/);

  const url2key = new Map<string, string>();
  const reg = (type: string, o: any) => {
    url2key.set(o.url, `${type}:${o.id}`);
    if (type === 'hooks') url2key.set(o.url.replace('/hooks/', '/webhooks/'), `${type}:${o.id}`);
  };
  for (const { e, fields } of engines)
    (reg('engines', e), fields.forEach((x) => reg('engine_fields', x)));
  wss.forEach((w) => reg('workspaces', w));
  hooks.forEach((h) => reg('hooks', h));
  for (const { q, s, i } of queues) (reg('schemas', s), reg('queues', q), reg('inboxes', i));
  rules.forEach((r) => reg('rules', r));

  const rewrite = (v: any): any =>
    typeof v === 'string'
      ? v === orgUrl
        ? '$org'
        : url2key.has(v)
          ? `$ref:${url2key.get(v)}`
          : v
      : Array.isArray(v)
        ? v.map(rewrite)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]))
          : v;
  const ops: any[] = [],
    patches: any[] = [];
  const add = (type: string, o: any, override: Record<string, unknown> = {}, matchName = true) => {
    const drop = new Set([...DROP_ALL, ...DROP[type]]);
    const body = rewrite({
      ...Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k))),
      ...override,
    });
    const op: any = { key: `${type}:${o.id}`, type, body };
    if (matchName) op.match = { name: body.name };
    ops.push(op);
    return op;
  };

  for (const { e } of engines) {
    add('engines', e, { organization: orgUrl });
    patches.push({
      key: `engines:${e.id}`,
      type: 'engines',
      body: { training_queues: (e.training_queues ?? []).map(rewrite) },
    });
  }
  for (const { fields } of engines)
    for (const x of fields) {
      // names repeat across engines -> adopt by engine + name
      const op = add('engine_fields', x, {}, false);
      op.match = { engine: op.body.engine, name: op.body.name };
    }
  for (const w of wss) add('workspaces', w, { organization: orgUrl });
  for (const h of topo(hooks)) {
    const priv = h.config?.private;
    const over: Record<string, unknown> = { queues: [], token_owner: '$token_owner' };
    if (priv)
      over.config = Object.fromEntries(
        Object.entries(h.config).filter(([k]) => !PRIVATE_DROP.includes(k)),
      );
    const op = add('hooks', h, over);
    if (priv) {
      op.template = lastId(h.hook_template);
      delete op.body.type;
    }
  }
  for (const { q, s, i } of queues) {
    add('schemas', s, { name: q.name });
    add('queues', q);
    add('inboxes', i, { name: q.name, queues: [q.url] });
  }
  for (const r of rules) add('rules', r, { organization: orgUrl });
  const plan = { source_url: src, release, ops, patches };
  selfCheck(plan, host);
  return plan;
}

// hooks in run_after order (a hook after the ones it runs after), ties by id
function topo(hooks: Map<number, any>) {
  const out: any[] = [],
    seen = new Set<number>();
  const visit = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const u of hooks.get(id).run_after ?? []) {
      if (!hooks.has(lastId(u))) throw new Error(`run_after to a hook outside the release: ${u}`);
      visit(lastId(u));
    }
    out.push(hooks.get(id));
  };
  [...hooks.keys()].sort((a, b) => a - b).forEach(visit);
  return out;
}

function selfCheck(plan: { ops: any[]; patches: any[] }, host: string) {
  const fail = (m: string) => {
    throw new Error(`the compiled plan is not valid: ${m}`);
  };
  if (JSON.stringify([plan.ops, plan.patches]).includes(host.replace('https://', '')))
    fail(`the source host ${host} is still in it`);
  const seen = new Set<string>();
  const refs = (b: unknown) => [...JSON.stringify(b).matchAll(/"\$ref:([^"]+)"/g)].map((m) => m[1]);
  for (const op of plan.ops) {
    if (!op.match) fail(`${op.key} has no match`);
    for (const r of refs(op.body)) if (!seen.has(r)) fail(`${op.key} uses ${r} before it exists`);
    seen.add(op.key);
  }
  for (const p of plan.patches)
    if (!seen.has(p.key) || refs(p.body).some((r) => !seen.has(r)))
      fail(`patch ${p.key} uses an object that is not created`);
}
