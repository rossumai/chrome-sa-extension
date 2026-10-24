// src/cib/engine.ts
// A generic create-plan engine: runs an ordered list of create ops (plus patches) against the
// Rossum API, resolving placeholders as it goes. Progress is checkpointed in Data Storage, so a run
// can resume after a closed tab or a crash. Plans and API objects are raw JSON, hence the `any`s.

const COLL = '_cib_deploy_runs';

export type ApiResult = { status: number; data: any };
export type Client = {
  call: (method: string, path: string, body?: unknown) => Promise<ApiResult>;
  ds: (op: string, body: Record<string, unknown>) => Promise<any>;
  list: (type: string, query?: string) => Promise<any[]>;
  base: string;
};
export type Progress = { phase: string; done: number; total: number; detail?: string };
type Sleep = (s: number) => unknown;

// 429: the API did not process the request, so it is safe to send again (also a POST);
// wait Retry-After seconds when given, else 1, 2, 4, 8, 16 s (seen on a test org, 2026-10-19: ~2 creates/s)
export function makeClient(
  base: string,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  { sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)) }: { sleep?: Sleep } = {},
): Client {
  const call = async (method: string, path: string, body?: unknown): Promise<ApiResult> => {
    let r: Response;
    for (let i = 0; ; i++) {
      r = await fetchImpl(path.startsWith('http') ? path : `${base}/api/v1/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.status !== 429 || i === 5) break;
      await sleep(Number(r.headers?.get?.('retry-after')) || 2 ** i);
    }
    const text = await r!.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: r!.status, data };
  };
  const ds = async (op: string, body: Record<string, unknown>) => {
    const r = await call('POST', `${base}/svc/data-storage/api/v1/data/${op}`, {
      ...body,
      collectionName: COLL,
    });
    if (r.status !== 200)
      throw new Error(`data storage ${op} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.result;
  };
  // every page of a list (pagination.next is a cursor url on the real API)
  const list = async (type: string, query = '') => {
    const out: any[] = [];
    for (let url: string | undefined = `${type}?page_size=100${query && '&' + query}`; url;) {
      const r = await call('GET', url);
      if (r.status !== 200)
        throw new Error(`list ${type} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      out.push(...r.data.results);
      url = r.data.pagination?.next;
    }
    return out;
  };
  return { call, ds, list, base };
}

// username + password -> token (works from an extension page: host permission, E11)
export async function login(
  base: string,
  username: string,
  password: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  const r = await fetchImpl(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200)
    throw new Error(`login failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).key;
}

// ctx = {idmap, org, owner, secrets}; placeholders are whole strings: "$org", "$token_owner", "$ref:<key>", "$secret:<name>"
// secrets are given per run and never stored: the checkpoint holds only the placeholder
export const subst = (v: any, ctx: any): any => {
  if (typeof v === 'string') {
    if (v === '$org') return ctx.org;
    if (v === '$token_owner') return ctx.owner;
    if (v.startsWith('$ref:')) return ctx.idmap[v.slice(5)].url;
    if (v.startsWith('$secret:')) {
      if (!(v.slice(8) in (ctx.secrets ?? {}))) throw new Error(`no value given for ${v}`);
      return ctx.secrets[v.slice(8)];
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => subst(x, ctx));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x, ctx)]));
  return v;
};

// list filters take the numeric id for a related object (engine=<url> -> 400), results carry the url
async function adopt(c: Client, op: any, ctx: any) {
  if (!op.match) return null;
  const match = subst(op.match, ctx);
  const q = new URLSearchParams(
    Object.entries(match).map(([k, v]: [string, any]) => [
      k,
      String(v).startsWith(`${c.base}/api/v1/`) ? v.split('/').pop() : v,
    ]),
  );
  const r = await c.call('GET', `${op.type}?${q}`);
  if (r.status !== 200) return null;
  return (
    r.data.results.find((o: any) => Object.entries(match).every(([k, v]) => o[k] === v)) || null
  );
}

const ok = (r: ApiResult) => r.status === 200 || r.status === 201;

// a Store-template hook: create it inactive from the template, then put the plan body on it
async function createFromTemplate(c: Client, op: any, body: any) {
  const r = await c.call('POST', 'hooks/create', {
    name: body.name,
    hook_template: `${c.base}/api/v1/hook_templates/${op.template}`,
    queues: [],
    events: [],
    active: false,
    token_owner: body.token_owner,
  });
  if (!ok(r)) return r;
  return c.call('PATCH', r.data.url, body);
}

// run (or resume) a plan; onEvent gets progress lines for a UI
// onProgress({phase: 'objects'|'patches', done, total, detail}) for a progress bar
export async function deploy(
  c: Client,
  {
    run,
    orgId,
    ops,
    patches = [],
    secrets = {},
    tokenOwner,
    onEvent = () => {},
    onProgress = () => {},
  }: {
    run: string;
    orgId: number;
    ops: any[];
    patches?: any[];
    secrets?: Record<string, string>;
    tokenOwner?: string;
    onEvent?: (line: string) => void;
    onProgress?: (p: Progress) => void;
  },
): Promise<Record<string, { id: number; url: string; type: string }>> {
  const org = `${c.base}/api/v1/organizations/${orgId}`;
  let [st] = await c.ds('find', { query: { kind: 'plan', run } });
  if (!st) {
    st = {
      kind: 'plan',
      run,
      status: 'running',
      ops,
      patches,
      cursor: 0,
      pcursor: 0,
      idmap: {},
      org,
      started: Date.now() / 1000,
      engine: 'js',
    };
    await c.ds('insert_one', { document: st });
  }
  const save = (fields: Record<string, unknown>) =>
    c.ds('update_one', { filter: { kind: 'plan', run }, update: { $set: fields } });
  const fail = async (what: string, r: ApiResult) => {
    await save({
      status: 'failed',
      error: `${what} -> ${r.status} ${JSON.stringify(r.data).slice(0, 500)}`,
    });
    throw new Error(`${what} failed: ${r.status}`);
  };
  const ctx = {
    idmap: st.idmap,
    org,
    secrets,
    owner: tokenOwner ?? (await c.call('GET', 'auth/user')).data?.url,
  };
  for (let cur = st.cursor; cur < st.ops.length; cur++) {
    const op = st.ops[cur];
    if (!st.idmap[op.key]) {
      let obj = await adopt(c, op, ctx),
        how = 'adopted';
      if (obj && op.template) {
        // may be a create whose body patch failed: it still holds the template defaults
        const r = await c.call('PATCH', obj.url, subst(op.body, ctx));
        if (!ok(r)) await fail(`create ${op.key}`, r);
      }
      if (!obj) {
        const body = subst(op.body, ctx);
        const r = op.template
          ? await createFromTemplate(c, op, body)
          : await c.call('POST', op.type, body);
        if (!ok(r)) await fail(`create ${op.key}`, r);
        obj = r.data;
        how = 'created';
      }
      st.idmap[op.key] = { id: obj.id, url: obj.url, type: op.type };
      onEvent(`${how} ${op.type} ${op.key} ${obj.id}`);
    }
    await save({ cursor: cur + 1, idmap: st.idmap });
    onProgress({
      phase: 'objects',
      done: cur + 1,
      total: st.ops.length,
      detail: `${op.type} ${op.body.name ?? op.key}`,
    });
  }
  for (let cur = st.pcursor ?? 0; cur < (st.patches ?? []).length; cur++) {
    const p = st.patches[cur];
    const r = await c.call('PATCH', st.idmap[p.key].url, subst(p.body, ctx));
    if (!ok(r)) await fail(`patch ${p.key}`, r);
    onEvent(`patched ${p.type} ${p.key}`);
    await save({ pcursor: cur + 1 });
    onProgress({
      phase: 'patches',
      done: cur + 1,
      total: st.patches.length,
      detail: `${p.type} ${p.key}`,
    });
  }
  await save({ status: 'done', finished: Date.now() / 1000 });
  return st.idmap;
}
