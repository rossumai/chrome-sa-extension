// src/cib/upgrade.ts
// Upgrade a CIB installation to a newer release by a three-way merge: base = the release installed
// (its configured op bodies, from the install record a complete deploy keeps), new = the release
// to install, live = the org now. A release change is applied only where the org still holds the
// base value; where the customer changed the same field it is a conflict, listed and left alone.
// Design: docs/superpowers/specs/2026-11-16-cib-upgrade-design.md. Plans and API objects are raw
// JSON, hence the `any`s.
import { adopt, deploy } from './engine.js';
import type { Client, Progress } from './engine.js';
import { configurePlan, findUser, hooksNeedingSecret, invokeImports, preflight } from './cib.js';

export type Install = {
  release: string;
  ops: any[];
  idmap: Record<string, { id: number; url: string; type: string }>;
  // true: from a complete deploy's record; false: the admin named the release
  recorded: boolean;
};

// the newest complete deploy (or upgrade) of the org
export async function findInstall(c: Client): Promise<Install | null> {
  const docs = await c.ds('find', { query: { kind: 'plan', complete: true } });
  const [d] = docs.sort((a: any, b: any) => (b.completed ?? 0) - (a.completed ?? 0));
  return d ? { release: d.release, ops: d.ops, idmap: d.idmap, recorded: true } : null;
}

const refsIn = (v: unknown) =>
  [...JSON.stringify(v ?? null).matchAll(/"\$ref:([^"]+)"/g)].map((m) => m[1]);

// no record: the configured ops of the release the admin names, found in the org by their match
export async function installFromRelease(c: Client, release: string, ops: any[], orgId: number) {
  const idmap: Install['idmap'] = {};
  const ctx = { idmap, org: `${c.base}/api/v1/organizations/${orgId}` };
  for (const op of ops) {
    if (refsIn(op.match).some((r) => !idmap[r])) continue; // its parent is not in the org
    const o = await adopt(c, op, ctx);
    if (o) idmap[op.key] = { id: o.id, url: o.url, type: op.type };
  }
  return { release, ops, idmap, recorded: false } as Install;
}

// the Coupa URL and client ID a deploy put into the schemas, so an upgrade configures with them
export function coupaFromInstall(ops: any[]): { baseUrl: string; clientId: string } | null {
  const found: Record<string, string> = {};
  const walk = (n: any): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.id === 'oauth_client_id' || n.id === 'coupa_api_base_url')
      found[n.id] ??= n.default_value;
    walk(n.children);
  };
  for (const op of ops) if (op.type === 'schemas') walk(op.body.content);
  return found.oauth_client_id && found.coupa_api_base_url
    ? { baseUrl: found.coupa_api_base_url, clientId: found.oauth_client_id }
    : null;
}

// placeholders as the org's values; an unknown $ref (an object not created yet) stays as it is
const resolve = (v: any, ctx: any): any => {
  if (typeof v === 'string') {
    if (v === '$org') return ctx.org;
    if (v === '$token_owner') return ctx.owner ?? v;
    if (v.startsWith('$ref:')) return ctx.idmap[v.slice(5)]?.url ?? v;
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, ctx));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, ctx)]));
  return v;
};

const canon = (v: any): any =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon(v[k])]),
        )
      : v;
const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
// the field that names each element of a list of objects, when every element has a different one:
// `id` (schema content and children), `//` (the labelled entries of a hook's configurations)
const keyOf = (v: unknown): string | null => {
  if (!Array.isArray(v) || !v.length || !v.every(isObj)) return null;
  for (const k of ['id', '//'])
    if (v.every((x) => k in x) && new Set(v.map((x) => x[k])).size === v.length) return k;
  return null;
};
const primArr = (v: unknown): v is unknown[] =>
  Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');
const short = (v: unknown) => {
  const s = JSON.stringify(v) ?? 'nothing';
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

type Notes = { conflicts: string[]; removed: string[] };

// the merged value for the org; conflicts and parts the release removed go to notes
function merge(b: any, n: any, l: any, path: string, out: Notes): any {
  if (eq(b, n) || eq(l, n)) return l; // the release did not change it, or the org already has it
  if (b === undefined) {
    // set for the first time by this release
    if (l === undefined) return n;
    out.conflicts.push(
      `${path}: new in the release as ${short(n)}, the organization has ${short(l)}`,
    );
    return l;
  }
  if (n === undefined) return l; // dropped by the release: a PATCH cannot drop a key, it stays
  if (isObj(b) && isObj(n) && isObj(l)) {
    const r = { ...l };
    for (const k of new Set([...Object.keys(b), ...Object.keys(n)])) {
      const v = merge(b[k], n[k], l[k], path ? `${path}.${k}` : k, out);
      if (v !== undefined) r[k] = v;
    }
    return r;
  }
  const k = keyOf(n) ?? keyOf(b);
  if (
    k &&
    keyOf(l) === k &&
    Array.isArray(b) &&
    Array.isArray(n) &&
    (!b.length || keyOf(b) === k)
  ) {
    // element by element on that field
    const by = (a: any[], id: unknown) => a.find((x) => x[k] === id);
    const r = [...l];
    n.forEach((ni: any, i: number) => {
      const p = `${path}[${k}=${ni[k]}]`,
        bi = by(b, ni[k]),
        at = r.findIndex((x) => x[k] === ni[k]);
      if (at >= 0) r[at] = merge(bi, ni, r[at], p, out);
      else if (!bi) {
        // new in the release: after its predecessor there, else at the end
        const prev = i ? r.findIndex((x) => x[k] === n[i - 1][k]) : -1;
        r.splice(prev >= 0 ? prev + 1 : r.length, 0, ni);
      } else if (!eq(bi, ni))
        out.conflicts.push(`${p}: changed by the release, removed in the organization`);
    });
    for (const bi of b)
      if (!by(n, bi[k]) && by(l, bi[k])) out.removed.push(`${path}[${k}=${bi[k]}]`);
    return r;
  }
  if (primArr(b) && primArr(n) && primArr(l)) {
    // a set of urls or names (queue.hooks, events): add what the release adds, drop what it drops
    const add = n.filter((x) => !b.includes(x) && !l.includes(x));
    return [...l.filter((x) => n.includes(x) || !b.includes(x)), ...add];
  }
  if (eq(l, b)) return n;
  out.conflicts.push(
    `${path}: release ${short(b)} -> ${short(n)}, the organization has ${short(l)}`,
  );
  return l;
}

// written by the API only, never compared or sent
const SKIP = new Set(['secrets']);

// a PATCH body with the top-level keys the merge changes
export function merge3(base: any, neu: any, live: any) {
  const notes: Notes = { conflicts: [], removed: [] };
  const patch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(neu)])) {
    if (SKIP.has(k)) continue;
    const v = merge(base[k], neu[k], live[k], k, notes);
    if (v !== undefined && !eq(v, live[k])) patch[k] = v;
  }
  return { patch, ...notes };
}

export type UpgradeItem = {
  key: string;
  type: string;
  name: string;
  action: 'create' | 'update' | 'same' | 'removed';
  url?: string;
  fields: string[];
  conflicts: string[];
  removed: string[];
};

// each op of the new release with the op of the install it continues (same key, else type + name)
function pairs(install: Install, ops: any[]) {
  const byKey = new Map(install.ops.map((o) => [o.key, o]));
  const byName = new Map(install.ops.map((o) => [`${o.type}|${o.body.name}`, o]));
  const used = new Set<string>();
  const out = ops.map((op) => {
    let b = byKey.get(op.key);
    if (!b && op.match && 'name' in op.match && Object.keys(op.match).length === 1)
      b = byName.get(`${op.type}|${op.body.name}`);
    if (b && used.has(b.key)) b = undefined;
    if (b) used.add(b.key);
    return { op, base: b as any };
  });
  return { out, gone: install.ops.filter((o) => !used.has(o.key)) };
}

// read-only: what an upgrade would do, object by object
async function diff(
  c: Client,
  install: Install,
  ops: any[],
  ctx0: { org: string; owner?: string },
) {
  const { out, gone } = pairs(install, ops);
  // the new release's keys -> the install's objects
  const idmap: Install['idmap'] = {};
  for (const { op, base } of out)
    if (base && install.idmap[base.key]) idmap[op.key] = install.idmap[base.key];
  const items: UpgradeItem[] = [];
  for (const { op, base } of out) {
    const name = op.body.name ?? op.key,
      ref = idmap[op.key];
    const live = ref && (await c.call('GET', ref.url));
    if (!base || !ref || live.status === 404) {
      delete idmap[op.key];
      items.push({
        key: op.key,
        type: op.type,
        name,
        action: 'create',
        fields: [],
        conflicts: [],
        removed: [],
      });
      continue;
    }
    if (live.status !== 200) throw new Error(`could not read ${ref.url}: HTTP ${live.status}`);
    const m = merge3(
      resolve(base.body, { ...ctx0, idmap: install.idmap }),
      resolve(op.body, { ...ctx0, idmap }),
      live.data,
    );
    const fields = Object.keys(m.patch);
    items.push({
      key: op.key,
      type: op.type,
      name,
      action: fields.length ? 'update' : 'same',
      url: ref.url,
      fields,
      conflicts: m.conflicts,
      removed: m.removed,
    });
  }
  for (const b of gone)
    if (install.idmap[b.key])
      items.push({
        key: b.key,
        type: b.type,
        name: b.body.name ?? b.key,
        action: 'removed',
        url: install.idmap[b.key].url,
        fields: [],
        conflicts: [],
        removed: [],
      });
  return { items, idmap };
}

export type UpgradeResult = {
  status: 'current' | 'blocked' | 'planned' | 'done';
  from: string;
  to: string;
  items: UpgradeItem[];
  blockers: string[];
  notes: string[];
  invoked?: { key: string; status: number }[];
  // created without client_secret: the organization's admin adds it to each
  needSecret?: { name: string; url: string }[];
};

// Check upgrade (apply false) reads and plans; Upgrade (apply true) also writes: creates through the
// deploy engine (checkpointed under `run`), then each update re-read and re-merged right before its
// PATCH, then the imports of created import hooks. The finished run becomes the install record.
export async function upgradeCib(
  c: Client,
  {
    install,
    plan,
    hooksCsv,
    region,
    orgId,
    coupa,
    tokenOwnerUsername,
    run,
    apply = false,
    onEvent = () => {},
    onProgress = () => {},
  }: {
    install: Install;
    plan: any;
    hooksCsv: string;
    region: string;
    orgId: number;
    coupa: { baseUrl: string; clientId: string; clientSecret?: string };
    tokenOwnerUsername?: string;
    run: string;
    apply?: boolean;
    onEvent?: (line: string) => void;
    onProgress?: (p: Progress) => void;
  },
): Promise<UpgradeResult> {
  const from = install.release,
    to = plan.release;
  const res = (r: Partial<UpgradeResult>): UpgradeResult => ({
    status: 'planned',
    from,
    to,
    items: [],
    blockers: [],
    notes: [],
    ...r,
  });
  if (install.recorded && from === to)
    return res({ status: 'current', notes: [`the organization is already on CIB ${to}`] });
  const p = configurePlan(plan, {
    coupa: { clientSecret: '', ...coupa },
    region,
    hooksCsv,
  });
  const org = `${c.base}/api/v1/organizations/${orgId}`;
  const ownerUrl = tokenOwnerUsername
    ? (await findUser(c, tokenOwnerUsername))?.url
    : (await c.call('GET', 'auth/user')).data?.url;
  onProgress({ phase: 'checks', done: 0, total: 1, detail: 'reading the installed objects' });
  const { items, idmap } = await diff(c, install, p.ops, { org, owner: ownerUrl });
  const created = new Set(items.filter((i) => i.action === 'create').map((i) => i.key));
  const createOps = p.ops.filter((o: any) => created.has(o.key));
  const createPatches = (p.patches ?? []).filter((x: any) => created.has(x.key));
  const blockers: string[] = [],
    notes: string[] = [];
  if (!install.recorded)
    notes.push(`no install record: the base is CIB ${from}, found in the organization by name`);
  if (createOps.length) {
    const pf = await preflight(c, { ops: createOps }, orgId, {
      tokenOwnerUsername,
      allowExisting: true,
      region,
    });
    blockers.push(...pf.blockers);
    notes.push(...pf.notes.filter((n) => !/already holds CIB objects|CIB schema/.test(n)));
  }
  const newSecretHooks = p.secretHooks.filter((k: string) => created.has(k));
  if (newSecretHooks.length && !coupa.clientSecret)
    notes.push(
      `the upgrade creates ${newSecretHooks.length} hooks that need the Coupa client secret; without it they are created active but without the secret, their first imports are not started, and the organization's admin adds client_secret to them`,
    );
  onProgress({ phase: 'checks', done: 1, total: 1 });
  if (blockers.length) return res({ status: 'blocked', items, blockers, notes });
  if (!apply) return res({ items, notes });

  const [st] = await c.ds('find', { query: { kind: 'plan', run } });
  if (st?.complete)
    return res({
      status: 'blocked',
      items,
      blockers: [`run ${run} is complete; use a new run ID`],
      notes,
    });
  // as deployCib: a resume follows the patches its checkpoint holds
  const stored = st ? (st.patches ?? []) : createPatches;
  if (!coupa.clientSecret && JSON.stringify(stored.slice(st?.pcursor ?? 0)).includes('$secret:'))
    return res({
      status: 'blocked',
      items,
      blockers: [
        `run ${run} was started with the Coupa client secret; enter it in step 2 to resume`,
      ],
      notes,
    });
  const secretless = newSecretHooks.length > 0 && !JSON.stringify(stored).includes('$secret:');
  // the existing objects go into the checkpoint first, so the engine creates only the new ones
  if (!st)
    await c.ds('insert_one', {
      document: {
        kind: 'plan',
        run,
        release: to,
        upgradeOf: from,
        status: 'running',
        ops: createOps,
        patches: createPatches,
        cursor: 0,
        pcursor: 0,
        idmap,
        org,
        started: Date.now() / 1000,
        engine: 'js',
      },
    });
  const full = await deploy(c, {
    run,
    orgId,
    release: to,
    ops: createOps,
    patches: createPatches,
    secrets: coupa.clientSecret ? { client_secret: coupa.clientSecret } : {},
    tokenOwner: ownerUrl,
    onEvent,
    onProgress,
  });
  // every update re-read and re-merged now: an edit made since the check becomes a conflict
  const byKey = new Map(p.ops.map((o: any) => [o.key, o]));
  const { out } = pairs(install, p.ops);
  const baseOf = new Map(out.map(({ op, base }) => [op.key, base]));
  const todo = items.filter((i) => i.action === 'update' || i.action === 'same');
  const final: UpgradeItem[] = items.filter((i) => !todo.includes(i));
  for (const [n, it] of todo.entries()) {
    const live = await c.call('GET', it.url!);
    if (live.status !== 200) throw new Error(`could not read ${it.url}: HTTP ${live.status}`);
    const m = merge3(
      resolve(baseOf.get(it.key).body, { org, owner: ownerUrl, idmap: install.idmap }),
      resolve((byKey.get(it.key) as any).body, { org, owner: ownerUrl, idmap: full }),
      live.data,
    );
    const fields = Object.keys(m.patch);
    if (fields.length) {
      const r = await c.call('PATCH', it.url!, m.patch);
      if (r.status !== 200)
        throw new Error(
          `update ${it.key} failed: ${r.status} ${JSON.stringify(r.data ?? '').slice(0, 300)}`,
        );
      onEvent(`updated ${it.type} ${it.key} ${it.url}: ${fields.join(', ')}`);
    }
    final.push({
      ...it,
      action: fields.length ? 'update' : 'same',
      fields,
      conflicts: m.conflicts,
      removed: m.removed,
    });
    onProgress({
      phase: 'updates',
      done: n + 1,
      total: todo.length,
      detail: `${it.type} ${it.name}`,
    });
  }
  const invoked = await invokeImports(
    c,
    full,
    p.invoke.filter((k: string) => created.has(k) && !(secretless && newSecretHooks.includes(k))),
    { onProgress },
  );
  const order = new Map(items.map((i, n) => [i.key, n]));
  final.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  await c.ds('update_one', {
    filter: { kind: 'plan', run },
    update: {
      $set: {
        complete: true,
        completed: Date.now() / 1000,
        ops: p.ops,
        patches: p.patches,
        idmap: full,
        conflicts: final.flatMap((i) => i.conflicts.map((x) => `${i.key} ${x}`)),
        ...(secretless && { secretGiven: false }),
      },
    },
  });
  notes.push(`run ${run} is complete: it is the install record of CIB ${to} now`);
  return res({
    status: 'done',
    items: final,
    notes,
    invoked,
    ...(secretless && {
      needSecret: hooksNeedingSecret({ ops: p.ops, secretHooks: newSecretHooks }, full),
    }),
  });
}

// one line that says how an upgrade check or run ended
export function upgradeVerdict(r: UpgradeResult): { tone: 'ok' | 'warn' | 'fail'; text: string } {
  const n = (a: UpgradeItem['action']) => r.items.filter((i) => i.action === a).length;
  const conflicts = r.items.reduce((s, i) => s + i.conflicts.length, 0);
  const facts = `${n('update')} to update, ${n('create')} to create, ${n('same')} unchanged, ${conflicts} conflicts, ${n('removed')} removed from the release`;
  if (r.status === 'current')
    return { tone: 'ok', text: `Up to date: the organization is on CIB ${r.to}.` };
  if (r.status === 'blocked')
    return {
      tone: 'fail',
      text: 'Blocked: nothing was written. Fix the blockers, then check again.',
    };
  if (r.status === 'planned')
    return {
      tone: conflicts ? 'warn' : 'ok',
      text: `Upgrade plan ${r.from} -> ${r.to}: ${facts}.`,
    };
  return {
    tone: conflicts || r.needSecret?.length ? 'warn' : 'ok',
    text: `Upgraded to ${r.to}: ${facts.replace(/to update/, 'updated').replace(/to create/, 'created')}${
      r.needSecret?.length
        ? `; ${r.needSecret.length} new hooks wait for the organization's admin to add client_secret`
        : ''
    }.`,
  };
}

// --- an organization without an install record --------------------------------------------------

// the Coupa URL and client ID in the org's own CIB schemas (the objects the release found by name)
async function coupaFromOrg(c: Client, idmap: Install['idmap']) {
  const bodies = [];
  for (const r of Object.values(idmap))
    if (r.type === 'schemas') {
      const s = await c.call('GET', r.url);
      if (s.status === 200) bodies.push({ type: 'schemas', body: s.data });
    }
  return coupaFromInstall(bodies);
}

// a release as the base of an org without a record: its ops found in the org by name, configured
// with the Coupa values of the form, and where the form is empty, those the org's schemas hold
export async function installFromOrg(
  c: Client,
  r: { tag: string; plan: any; hooksCsv: string },
  {
    region,
    orgId,
    coupa,
  }: { region: string; orgId: number; coupa: { baseUrl: string; clientId: string } },
) {
  const conf = (k: { baseUrl: string; clientId: string }) =>
    configurePlan(r.plan, { coupa: { ...k, clientSecret: '' }, region, hooksCsv: r.hooksCsv }).ops;
  // names do not depend on the Coupa values, so the first pass finds the same objects
  const found = await installFromRelease(c, r.tag, conf({ baseUrl: '', clientId: '' }), orgId);
  const org = coupa.baseUrl && coupa.clientId ? null : await coupaFromOrg(c, found.idmap);
  const k = {
    baseUrl: coupa.baseUrl || org?.baseUrl || '',
    clientId: coupa.clientId || org?.clientId || '',
  };
  if (!k.baseUrl || !k.clientId)
    throw new Error(
      'the Coupa URL and client ID are neither in step 2 nor in the organization’s CIB schemas; enter them in step 2',
    );
  return { install: { ...found, ops: conf(k) } as Install, coupa: k, fromOrg: !!org };
}

// how much of a release the org does not hold: per key the release sets, 1 when the live value
// differs; a list counts its elements the org lacks (so a reordered list counts 0, and only the one
// changed entry of a long list counts)
const lacks = (r: any, l: any): number => {
  if (eq(r, l)) return 0;
  if (isObj(r) && isObj(l))
    return Object.keys(r).reduce((s, k) => s + (SKIP.has(k) ? 0 : lacks(r[k], l[k])), 0);
  if (Array.isArray(r) && Array.isArray(l)) {
    const k = keyOf(r);
    return r.reduce((s: number, x: any) => {
      if (l.some((y) => eq(x, y))) return s;
      const m = k && l.find((y) => isObj(y) && y[k] === x[k]);
      return s + (m ? lacks(x, m) : 1);
    }, 0);
  }
  return 1;
};

export type Guess = { tag: string; found: number; total: number; lacks: number };

// which release an org without a record was deployed from: each candidate's objects found by name
// and compared with the org, fewest differences first (an object not found counts 1). Read-only;
// the GETs are shared between candidates.
export async function guessInstalled(
  c: Client,
  releases: { tag: string; plan: any; hooksCsv: string }[],
  opts: { region: string; orgId: number; coupa: { baseUrl: string; clientId: string } },
  onProgress: (p: Progress) => void = () => {},
): Promise<Guess[]> {
  const memo = new Map<string, ReturnType<Client['call']>>();
  const cc: Client = {
    ...c,
    call: (m, p, b) => {
      if (m !== 'GET') return c.call(m, p, b);
      if (!memo.has(p)) memo.set(p, c.call(m, p, b));
      return memo.get(p)!;
    },
  };
  const org = `${c.base}/api/v1/organizations/${opts.orgId}`;
  const out: Guess[] = [];
  for (const [n, r] of releases.entries()) {
    onProgress({
      phase: 'checks',
      done: n,
      total: releases.length,
      detail: `comparing with ${r.tag}`,
    });
    const { install } = await installFromOrg(cc, r, opts);
    let lack = 0;
    for (const op of install.ops) {
      const ref = install.idmap[op.key];
      const live = ref && (await cc.call('GET', ref.url));
      lack +=
        live?.status === 200
          ? lacks(resolve(op.body, { org, idmap: install.idmap }), live.data)
          : 1;
    }
    out.push({
      tag: r.tag,
      found: Object.keys(install.idmap).length,
      total: install.ops.length,
      lacks: lack,
    });
  }
  onProgress({ phase: 'checks', done: releases.length, total: releases.length });
  return out.sort((a, b) => a.lacks - b.lacks);
}
