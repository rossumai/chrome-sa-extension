import { deploy } from './engine.js';
import type { ApiResult, Client, Progress } from './engine.js';

// A compiled release plan and the API objects it creates are raw JSON, hence the `any`s.
type Coupa = { baseUrl: string; clientId: string; clientSecret: string };
type WaitOpts = {
  waitS?: number;
  pollS?: number;
  sleep?: (s: number) => unknown;
  onProgress?: (p: Progress) => void;
};

// CIB-specific steps around the generic engine, ported from coupa-integration-deploy-tool v1.3.3
// (Python helpers.py: update_prd_mapping, handle_hooks). Key difference: the target Coupa values
// go into the plan BEFORE the create, so no hook ever holds the CIB source tenant. Hooks that need
// the Coupa secret are created inactive; one patch then sets the secret and restores their active flag.

export const REGIONS = ['prod-eu', 'prod-eu2', 'prod-us2', 'prod-jp'];

// the hooks build URLs by concatenation (f"{url}oauth2/token"), so: a scheme and exactly one trailing slash
export const normalizeBaseUrl = (url: string | null | undefined): string => {
  url = (url ?? '').trim();
  if (!url) return url;
  if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\/+$/, '') + '/';
};

// hooks.csv of a CIB release: no quoted fields
export const parseCsv = (text: string): Record<string, string>[] => {
  const [head, ...rows] = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};

function setCoupaSettings(s: any, base: string, clientId: string) {
  if (s.credentials && typeof s.credentials === 'object' && 'client_id' in s.credentials)
    Object.assign(s.credentials, { client_id: clientId, base_api_url: base });
  const src = Array.isArray(s.configurations) ? s.configurations[0]?.source : null;
  if (src?.auth && typeof src.auth === 'object') {
    src.auth.url = `${base}oauth2/token`;
    (src.auth.body ??= {}).client_id = clientId;
    if (Array.isArray(src.queries) && src.queries.length)
      src.queries[0].url = `${base}api/invoices/`;
  }
  if ('client_id' in s) s.client_id = clientId;
  if ('coupa_base_url' in s) s.coupa_base_url = base;
}

export function configurePlan(
  plan: any,
  { coupa, region, hooksCsv }: { coupa: Coupa; region: string; hooksCsv: string },
) {
  if (!REGIONS.includes(region))
    throw new Error(`unknown region ${region}; use one of ${REGIONS.join(', ')}`);
  const base = normalizeBaseUrl(coupa.baseUrl);
  const rows = Object.fromEntries(parseCsv(hooksCsv).map((r) => [r.hook_name, r]));
  const ops = structuredClone(plan.ops),
    patches = structuredClone(plan.patches ?? []),
    invoke: string[] = [];
  for (const op of ops) {
    const b = op.body;
    if (op.type === 'schemas') {
      const values: Record<string, string> = {
        oauth_client_id: coupa.clientId,
        coupa_api_base_url: base,
      };
      for (const sec of b.content ?? [])
        for (const ch of sec.children ?? [])
          if (ch.id in values)
            Object.assign(ch, { default_value: values[ch.id], formula: `'${values[ch.id]}'` });
    }
    if (op.type !== 'hooks') continue;
    if (b.settings) setCoupaSettings(b.settings, base, coupa.clientId);
    const row = rows[b.name];
    if (!row) continue;
    if (row[`${region}-url`]) (b.config ??= {}).url = row[`${region}-url`];
    if (row.patch_secret === 'true') {
      patches.push({
        key: op.key,
        type: 'hooks',
        body: { secrets: { client_secret: '$secret:client_secret' }, active: b.active },
      });
      b.active = false;
    }
    if (row.invoke === 'true') invoke.push(op.key);
  }
  return { ...plan, ops, patches, invoke };
}

// Coupa puts the granted scopes only in the access_token JWT `scope` claim, not in the response body
const jwtScopes = (token: string): Set<string> => {
  const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return new Set(
    (JSON.parse(atob(b64 + '='.repeat(-b64.length & 3))).scope ?? '').split(/\s+/).filter(Boolean),
  );
};

// tool v1.3.3 verify_credentials: invalid or under-scoped blocks; an unanswerable probe only warns
export async function checkCoupa(
  fetchImpl: typeof fetch,
  coupa: Coupa,
  requiredScopes: string[],
): Promise<{ status: string; detail?: string; missing?: string[]; extra?: string[] }> {
  let r: Response;
  try {
    r = await fetchImpl(`${normalizeBaseUrl(coupa.baseUrl)}oauth2/token`, {
      method: 'POST',
      credentials: 'omit', // with credentials, Coupa's 401 makes Chrome open a sign-in dialog
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: coupa.clientId,
        client_secret: coupa.clientSecret,
      }).toString(),
    });
  } catch (e: any) {
    return { status: 'unchecked', detail: `Coupa token endpoint not reachable: ${e.message}` };
  }
  const text = await r.text();
  if (!r.ok) return { status: 'invalid', detail: `HTTP ${r.status}: ${text.slice(0, 300)}` };
  let granted: Set<string>;
  try {
    granted = jwtScopes(JSON.parse(text).access_token);
  } catch (e: any) {
    return { status: 'unchecked', detail: `credential valid, scopes not readable: ${e.message}` };
  }
  return judgeScopes(granted, requiredScopes);
}

const judgeScopes = (granted: Set<string>, requiredScopes: string[]) => {
  const missing = requiredScopes.filter((s) => !granted.has(s)),
    extra = [...granted].filter((s) => !requiredScopes.includes(s)).sort();
  return { status: missing.length ? 'missing_scopes' : 'ok', missing, extra };
};

// The same Coupa token call, made by a function hook in the target org instead of the client.
// The user deploys the function and tears it down with their own clicks; a Check uses it while it
// exists. The secret goes into the hook's write-only `secrets` before each run, never into the
// invoke body; the function returns only the HTTP status and the granted scopes, not the token.
// A function reaches the internet only if the organization's serverless security context allows
// HTTPS (a Rossum-side setting, not readable over the API); if not -> 'unchecked'.
export const COUPA_PROBE_NAME = 'CIB deploy: Coupa credentials check'; // no "(CIB)" marker
const COUPA_PROBE_CODE = `
import base64, json, threading, urllib.error, urllib.parse, urllib.request

def rossum_hook_request_handler(payload):
    out = {}
    def call():
        try:
            form = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": payload["client_id"],
                                           "client_secret": payload["secrets"]["client_secret"]}).encode()
            req = urllib.request.Request(payload["token_url"], data=form,
                                         headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=10) as r:
                out["http_status"], body = r.status, r.read()
            p = json.loads(body)["access_token"].split(".")[1]
            out["scope"] = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))).get("scope") or ""
        except urllib.error.HTTPError as e:
            out.update(http_status=e.code, error=e.read().decode(errors="replace")[:300])
        except Exception as e:
            out["error"] = f"{type(e).__name__}: {e}"[:300]
            out["timeout"] = isinstance(getattr(e, "reason", e), TimeoutError)
    # the thread gives a hard limit: urlopen's timeout does not cover a DNS lookup that hangs
    th = threading.Thread(target=call, daemon=True)
    th.start()
    th.join(25)
    return out or {"error": "no answer within 25 s", "timeout": True}
`;

// the name alone is not proof: anyone who can make hooks can plant one with this name to get the secret
const isCoupaProbe = (h: any) =>
  h?.name === COUPA_PROBE_NAME &&
  h.type === 'function' &&
  h.config?.code?.trim() === COUPA_PROBE_CODE.trim();

export const findCoupaProbes = async (c: Client) => (await c.list('hooks')).filter(isCoupaProbe);

// an existing check function is re-used, so a second click does not make a second one
export async function deployCoupaProbe(c: Client): Promise<any> {
  const [old] = await findCoupaProbes(c);
  if (old) return old;
  const h = await c.call('POST', 'hooks', {
    name: COUPA_PROBE_NAME,
    type: 'function',
    events: ['invocation.manual'],
    queues: [],
    active: true,
    config: {
      runtime: 'python3.12',
      code: COUPA_PROBE_CODE,
      third_party_library_pack: 'default', // the Rossum UI cannot show a hook with null here
      timeout_s: 30,
    },
  });
  if (h.status !== 201)
    throw new Error(
      `could not create the Coupa check function: HTTP ${h.status} ${JSON.stringify(h.data).slice(0, 200)}`,
    );
  return h.data;
}

// deletes every check function (also ones left from an earlier session, or deployed by an
// older build with other code: so the name alone is enough here); returns how many
export async function teardownCoupaProbes(c: Client): Promise<number> {
  const hs = (await c.list('hooks')).filter(
    (h: any) => h.name === COUPA_PROBE_NAME && h.type === 'function',
  );
  for (const h of hs) {
    const r = await c.call('DELETE', h.url);
    if (r.status >= 300 && r.status !== 404)
      throw new Error(`could not delete ${h.url}: HTTP ${r.status}`);
  }
  return hs.length;
}

export async function checkCoupaViaFunction(
  c: Client,
  hookUrl: string,
  coupa: Coupa,
  requiredScopes: string[],
  {
    waitS = 120,
    sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)),
  }: { waitS?: number; sleep?: (s: number) => unknown } = {},
): Promise<{ status: string; detail?: string; missing?: string[]; extra?: string[] }> {
  if (!isCoupaProbe((await c.call('GET', hookUrl)).data))
    return {
      status: 'unchecked',
      detail: `${hookUrl} is not the check function this page deploys`,
    };
  const s = await c.call('PATCH', hookUrl, { secrets: { client_secret: coupa.clientSecret } });
  if (s.status !== 200)
    return {
      status: 'unchecked',
      detail: `could not give the Coupa secret to the check function ${hookUrl}: HTTP ${s.status}`,
    };
  // a new function builds for a while ("pending"), then may answer 400 FunctionNotReady (E5, 2026-10-13)
  let r: ApiResult = { status: 0, data: null };
  for (let t = 0; t <= waitS; t += 5) {
    const st = (await c.call('GET', hookUrl)).data?.config?.status;
    if (st === 'failed')
      return { status: 'unchecked', detail: 'the Coupa check function did not build' };
    if (st !== 'pending') {
      r = await c.call('POST', `${hookUrl}/invoke`, {
        token_url: `${normalizeBaseUrl(coupa.baseUrl)}oauth2/token`,
        client_id: coupa.clientId,
      });
      if (!(r.status === 400 && JSON.stringify(r.data).includes('FunctionNotReady'))) break;
    }
    await sleep(5);
  }
  const o = r.data ?? {};
  if (r.status !== 200)
    return {
      status: 'unchecked',
      detail: `the Coupa check function did not run: HTTP ${r.status} ${JSON.stringify(o).slice(0, 200)}`,
    };
  // a blocked organization drops the packets, so the connect hangs; a new HTTPS allowance
  // can take some minutes before functions get it (seen 2026-10-25)
  if (o.timeout)
    return {
      status: 'no_egress',
      detail: `the check function could not connect to Coupa (${o.error}), so the Coupa credentials were not checked. The organization does not allow HTTPS from functions, or a new allowance is not active yet: wait some minutes and click Check again`,
    };
  if (o.http_status === undefined)
    return {
      status: 'unreachable',
      detail: `the check function could not reach Coupa (${o.error}); the organization may not allow HTTPS from functions`,
    };
  if (o.http_status !== 200)
    return { status: 'invalid', detail: `HTTP ${o.http_status}: ${o.error}` };
  if (typeof o.scope !== 'string')
    return { status: 'unchecked', detail: `credential valid, scopes not readable: ${o.error}` };
  return judgeScopes(new Set(o.scope.split(/\s+/).filter(Boolean)), requiredScopes);
}

// names that mean "a CIB deploy already happened here" (tool v1.3.3 CIB_MARKERS)
const CIB_MARKERS = ['(CIB)', 'Coupa Integration Baseline', 'AP Documents'];
const isCib = (o: any) =>
  o.name && o.status !== 'deletion_requested' && CIB_MARKERS.some((m) => o.name.includes(m));

// read-only checks before anything is created; blockers stop the deploy, notes are shown
export const findUser = async (c: Client, username: string) =>
  (await c.list('users')).find((x) => x.username === username) ?? null;

// allowExisting: continue a half-built deploy (adopt by name) -> the CIB-objects blocker becomes a note
export async function preflight(
  c: Client,
  plan: any,
  orgId: number,
  {
    tokenOwnerUsername,
    allowExisting = false,
    region,
  }: { tokenOwnerUsername?: string; allowExisting?: boolean; region?: string } = {},
) {
  const blockers: string[] = [],
    notes: string[] = [],
    api = `${c.base}/api/v1`,
    org = `${api}/organizations/${orgId}`;

  // 1. no CIB objects yet: the deploy is a fresh install, a second one would duplicate everything
  const found: Record<string, string[]> = {};
  for (const t of ['workspaces', 'queues', 'hooks', 'rules'])
    found[t] = (await c.list(t)).filter(isCib).map((o) => o.name);
  const shown = Object.entries(found)
    .filter(([, v]) => v.length)
    .map(([t, v]) => `${v.length} ${t}: ${v.slice(0, 4).join(', ')}`);
  if (shown.length)
    (allowExisting ? notes : blockers).push(
      `the organization already holds CIB objects (${shown.join('; ')})${allowExisting ? '; they are adopted by name' : '; deploy into a clean organization'}`,
    );
  const schemas = (await c.list('schemas')).filter(isCib);
  if (schemas.length)
    notes.push(
      `${schemas.length} CIB schema(s) from an earlier deploy stay; they do not block the deploy`,
    );

  // 2. organization group features
  const o = await c.call('GET', org),
    g = o.status === 200 ? await c.call('GET', o.data.organization_group) : o;
  if (g.status !== 200)
    notes.push(`could not read the organization group (${g.status}); feature check skipped`);
  else {
    // the region picks each hook's regional service url (hooks.csv); the group knows its own
    // (`deployment_location`, e.g. 'prod-eu2', read live on a test org 2026-10-24)
    const loc = g.data.deployment_location;
    if (region && typeof loc === 'string' && loc && loc !== region)
      blockers.push(
        `region ${region} does not match the organization: its deployment location is ${loc}; choose ${loc}`,
      );
    else if (region && !(typeof loc === 'string' && loc))
      notes.push(`region ${region} not checked: the organization group has no deployment location`);
    const f = g.data.features ?? {},
      mht = f.maximum_hook_timeout ?? {};
    const allowed = mht.enabled ? mht.seconds : 60;
    const needed = Math.max(
      0,
      ...plan.ops
        .filter((op: any) => op.type === 'hooks')
        .map((op: any) => op.body.config?.timeout_s ?? 0),
    );
    if (needed > allowed)
      blockers.push(
        `hooks need config.timeout_s up to ${needed} s, organization group '${g.data.name}' allows at most ${allowed} s; ask Rossum support to enable maximum_hook_timeout`,
      );
    if (!f.einvoicing?.enabled)
      notes.push(
        `einvoicing is not enabled for the organization group; the e-invoicing inbox will not work`,
      );
  }

  // 3. Store templates visible to this organization
  const byTemplate: Record<string, string[]> = {};
  for (const op of plan.ops) if (op.template) (byTemplate[op.template] ??= []).push(op.body.name);
  for (const [id, names] of Object.entries(byTemplate)) {
    const r = await c.call('GET', `hook_templates/${id}`);
    if (r.status === 404)
      blockers.push(
        `hook_templates/${id} is not visible to this organization (${names.length} hooks: ${names.slice(0, 3).join(', ')}); ask Rossum support to expose it`,
      );
    else if (r.status !== 200) notes.push(`could not check hook_templates/${id} (${r.status})`);
  }

  // 4. token owner: the hooks run as this user, which must be a local user of the target org.
  //    The caller may be a group admin from another org (tool v1.3.3 token_owner_username).
  const u = tokenOwnerUsername
    ? await findUser(c, tokenOwnerUsername)
    : ((await c.call('GET', 'auth/user')).data ?? {});
  const who = tokenOwnerUsername
    ? `token owner '${tokenOwnerUsername}'`
    : 'token owner (the logged-in user)';
  if (!u || u.organization !== org)
    blockers.push(
      `${who} is not a user of organization ${orgId}; name a local admin of the target organization`,
    );
  else {
    const admin = new Set(
      (await c.list('groups'))
        .filter((r) => ['admin', 'organization_group_admin'].includes(r.name))
        .map((r) => r.url),
    );
    if (!(u.groups ?? []).some((x: string) => admin.has(x)))
      notes.push(`${who} is not an admin; hooks may fail at run time`);
  }
  return { blockers, notes };
}

// collections the memorisation hooks write to (tool v1.3.3 handle_memorisation_datasets)
export const MEMORISATION = [
  '_supplier_memorization_test',
  '_customer_memorization_test',
  '_tax_code_memorization',
];

const dsUrl = (c: Client, op: string) => `${c.base}/svc/data-storage/api/v1/${op}`;

// an existing collection answers non-2xx; like the tool, that is reported, not fatal
export async function createMemorisation(c: Client) {
  const out = [];
  for (const name of MEMORISATION)
    out.push({
      name,
      what: 'collection',
      ok: ok2xx(await c.call('POST', dsUrl(c, 'collections/create'), { collectionName: name })),
    });
  for (const name of MEMORISATION)
    out.push({
      name,
      what: 'index',
      ok: ok2xx(
        await c.call('POST', dsUrl(c, 'indexes/create'), {
          collectionName: name,
          indexName: '__dynamic_index',
          keys: { '$**': 1 },
        }),
      ),
    });
  return out;
}
const ok2xx = (r: { status: number }) => r.status >= 200 && r.status < 300;

// first import run now instead of at the next cron tick; one failure does not stop the others.
// MDH watermark: ${last_modified_date} resumes from the last finished operation per (org, dataset_name),
// and a teardown cannot clear that log (seen on test orgs, 13 Oct 2026). So a dataset with
// a finished operation gets its first import from the epoch; the anchor is restored once the job's operation
// shows (a dispatched job carries its own copy of the settings).
const ANCHOR = '${last_modified_date}',
  EPOCH = '1970-01-01T00:00:00Z';
const mdhOps = async (c: Client, dataset: string): Promise<any[]> => {
  const r = await c.call(
    'GET',
    `${c.base}/svc/master-data-hub/api/v1/operation/?${new URLSearchParams({ dataset_name: dataset, limit: '100' })}`,
  );
  return r.status === 200 ? (r.data.operations ?? []) : [];
};
export async function invokeImports(
  c: Client,
  idmap: Record<string, { id: number }>,
  keys: string[],
  {
    waitS = 900,
    pollS = 15,
    sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)),
    onProgress = () => {},
  }: WaitOpts = {},
) {
  const out: { key: string; status: number; seeded?: boolean }[] = [],
    seeded: any[] = [];
  for (const key of keys) {
    const path = `hooks/${idmap[key].id}`,
      s = (await c.call('GET', path)).data?.settings,
      ic = s?.import_config;
    const anchors = Object.entries(ic?.query ?? {})
      .filter(([, v]) => v === ANCHOR)
      .map(([k]) => k);
    let seed: any = null;
    if (anchors.length && ic.dataset_name) {
      const ops = await mdhOps(c, ic.dataset_name);
      if (ops.some((o) => o.status === 'finished')) {
        const query = { ...ic.query, ...Object.fromEntries(anchors.map((k) => [k, EPOCH])) };
        if (
          ok2xx(
            await c.call('PATCH', path, { settings: { ...s, import_config: { ...ic, query } } }),
          )
        )
          seed = {
            key,
            path,
            settings: s,
            dataset: ic.dataset_name,
            before: new Set(ops.map((o) => o.operation_id)),
          };
      }
    }
    const status = (await c.call('POST', `${path}/invoke`)).status;
    out.push({ key, status, ...(seed && { seeded: true }) });
    onProgress({
      phase: 'imports',
      done: out.length,
      total: keys.length,
      detail: `${ic?.dataset_name ?? key}: HTTP ${status}${seed ? ', full import from the epoch' : ''}`,
    });
    if (seed && ok2xx({ status })) seeded.push(seed);
    else if (seed) await c.call('PATCH', path, { settings: s });
  }
  const nSeeded = seeded.length;
  for (let waited = 0; seeded.length; waited += pollS) {
    onProgress({
      phase: 'restore',
      done: nSeeded - seeded.length,
      total: nSeeded,
      detail: `waiting for the full import job of ${seeded.map((x) => x.dataset).join(', ')} to start (${waited} s)`,
    });
    for (const x of [...seeded])
      if (
        waited >= waitS ||
        (await mdhOps(c, x.dataset)).some((o) => !x.before.has(o.operation_id))
      ) {
        await c.call('PATCH', x.path, { settings: x.settings });
        seeded.splice(seeded.indexOf(x), 1);
      }
    if (seeded.length) await sleep(pollS);
  }
  return out;
}

// {dataset_name: hook name} for the hooks the deploy invokes
export const importDatasets = (plan: any) =>
  Object.fromEntries(
    plan.ops
      .filter((op: any) => plan.invoke.includes(op.key))
      .map((op: any) => [op.body.settings?.import_config?.dataset_name, op.body.name])
      .filter(([d]: any[]) => d),
  );

// a dataset exists only after rows were written (the import writes __tmp_<name> first): returns the ones still missing
export async function waitImports(
  c: Client,
  datasets: string[],
  {
    waitS = 180,
    pollS = 20,
    sleep = (s) => new Promise((r) => setTimeout(r, s * 1000)),
    onProgress = () => {},
  }: WaitOpts = {},
) {
  let pending = [...datasets];
  for (let waited = 0; ; waited += pollS) {
    const r = await c.call('POST', dsUrl(c, 'collections/list'), {});
    const have: string[] = ok2xx(r) ? r.data.result : [];
    pending = pending.filter((d) => !have.some((x) => x === d || x.startsWith(`__tmp_${d}`)));
    onProgress({
      phase: 'datasets',
      done: datasets.length - pending.length,
      total: datasets.length,
      detail: pending.length
        ? `waiting for ${pending.join(', ')} (${waited} of ${waitS} s)`
        : 'all datasets present',
    });
    if (!pending.length || waited >= waitS) return pending;
    await sleep(pollS);
  }
}

// the whole deploy in the order of tool v1.3.3 deploy_cib(). A run with a checkpoint is a resume:
// its own objects are already in the org, so the read-only checks are skipped.
// coupaFetch: a fetch that can reach Coupa (Node, extension); omit it where it cannot (in-tab).
// coupaProbe: url of a deployed check function (deployCoupaProbe); the Coupa check runs there instead.
// checkOnly: stop after the read-only checks (status ready | blocked | resumable).
export async function deployCib(
  c: Client,
  {
    plan,
    orgId,
    run,
    coupa,
    region,
    hooksCsv,
    requiredScopes,
    coupaFetch,
    coupaProbe,
    tokenOwnerUsername,
    allowExisting,
    checkOnly,
    waitOpts,
    onEvent = () => {},
    onProgress = () => {},
  }: {
    plan: any;
    orgId: number;
    run: string;
    coupa: Coupa;
    region: string;
    hooksCsv: string;
    requiredScopes: string[];
    coupaFetch?: typeof fetch;
    coupaProbe?: string;
    tokenOwnerUsername?: string;
    allowExisting?: boolean;
    checkOnly?: boolean;
    waitOpts?: WaitOpts;
    onEvent?: (line: string) => void;
    onProgress?: (p: Progress) => void;
  },
): Promise<{
  status: 'ready' | 'blocked' | 'resumable' | 'done';
  notes: string[];
  blockers?: string[];
  idmap?: Record<string, { id: number; url: string; type: string }>;
  memorisation?: { name: string; what: string; ok: boolean }[];
  invoked?: { key: string; status: number; seeded?: boolean }[];
  pendingImports?: string[];
}> {
  const p = configurePlan(plan, { coupa, region, hooksCsv });
  const notes: string[] = [];
  const [resumed] = await c.ds('find', { query: { kind: 'plan', run } });
  if (!resumed) {
    onProgress({
      phase: 'checks',
      done: 0,
      total: 1,
      detail: 'Coupa credentials and organization checks (read-only)',
    });
    const blockers: string[] = [];
    const k = coupaProbe
      ? await checkCoupaViaFunction(c, coupaProbe, coupa, requiredScopes, {
          sleep: waitOpts?.sleep,
        })
      : coupaFetch && (await checkCoupa(coupaFetch, coupa, requiredScopes));
    if (!k) notes.push('Coupa credentials not checked from this client');
    else {
      if (k.status === 'invalid') blockers.push(`Coupa rejected the credentials: ${k.detail}`);
      if (k.status === 'missing_scopes')
        blockers.push(`the Coupa credentials miss scopes: ${k.missing!.join(', ')}`);
      if (k.status === 'no_egress' || k.status === 'unreachable') blockers.push(k.detail!);
      if (k.status === 'unchecked') notes.push(k.detail!);
      if (k.status === 'ok')
        notes.push(
          requiredScopes.length
            ? `Coupa accepted the credentials and grants all ${requiredScopes.length} required scopes`
            : 'Coupa accepted the credentials; scopes not checked (no readable required_scopes.json)',
        );
    }
    const pf = await preflight(c, p, orgId, { tokenOwnerUsername, allowExisting, region });
    blockers.push(...pf.blockers);
    notes.push(...pf.notes);
    if (blockers.length) return { status: 'blocked', blockers, notes };
    if (checkOnly) return { status: 'ready', notes };
  } else if (checkOnly)
    return {
      status: 'resumable',
      notes: [
        `run ${run} has a checkpoint (${resumed.status}, op ${resumed.cursor}/${resumed.ops.length})`,
      ],
    };
  const idmap = await deploy(c, {
    run,
    orgId,
    ops: p.ops,
    patches: p.patches,
    secrets: { client_secret: coupa.clientSecret },
    tokenOwner: tokenOwnerUsername && (await findUser(c, tokenOwnerUsername)).url,
    onEvent,
    onProgress,
  });
  onProgress({
    phase: 'memorisation',
    done: 0,
    total: 1,
    detail: 'memorisation collections and indexes',
  });
  const memorisation = await createMemorisation(c);
  const invoked = await invokeImports(c, idmap, p.invoke, { ...waitOpts, onProgress });
  const pendingImports = await waitImports(c, Object.keys(importDatasets(p)), {
    ...waitOpts,
    onProgress,
  });
  // The checkpoint is only for a resume. With every dataset filled the run is complete, so it goes;
  // with imports still pending it stays: Deploy with the same run ID then re-runs only the imports.
  if (pendingImports.length)
    notes.push(
      `the checkpoint of run ${run} stays in Data Storage: press Deploy with the same run ID to re-run the imports`,
    );
  else {
    await c.ds('delete_one', { filter: { kind: 'plan', run } });
    notes.push(`run ${run} is complete; its checkpoint is deleted from Data Storage`);
  }
  return { status: 'done', idmap, memorisation, invoked, pendingImports, notes };
}

// required_scopes.json of a release: {"required_scopes": {scope: "datasets it unlocks"}}
// a malformed file -> no scope check, as tool v1.3.4 _load_required_scopes (release v2.0.0 ships
// its file with a stray "ok, " in front of the JSON)
export const readRequiredScopes = (text: string): string[] => {
  try {
    return Object.keys(JSON.parse(text).required_scopes ?? {});
  } catch {
    return [];
  }
};
