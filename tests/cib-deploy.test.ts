import { test } from 'vitest';
import assert from 'node:assert/strict';
import { configurePlan, parseCsv, normalizeBaseUrl } from '../src/cib/cib.js';
import type { FakeRossum } from './support/fakeRossum.js';
import { realRelease } from './support/cibRelease.js';

const REL = await realRelease('v2.0.1');
const realPlan = () => structuredClone(REL.plan);
const realCsv: string = REL.hooksCsv;
const COUPA = { baseUrl: 'acme-test.coupahost.com', clientId: 'CID-NEW', clientSecret: 'S3CRET' };
const CIB_V2_0_1_OBJECT_COUNT = 219;

const hook = (name: string, body: any = {}): any => ({
  key: `hooks:${name}`,
  type: 'hooks',
  body: { name, active: true, settings: {}, config: {}, ...body },
});
const csv = `hook_name,prod-eu-url,prod-eu2-url,prod-us2-url,prod-jp-url,patch_secret,invoke
Imp,,,,,true,true
Map,https://eu,https://eu2,https://us2,https://jp,false,false
Plain,,,,,false,false`;
const run = (ops: any[], region = 'prod-eu') =>
  configurePlan({ ops, patches: [] }, { coupa: COUPA, region, hooksCsv: csv });

test('normalizeBaseUrl adds the scheme and exactly one trailing slash', () => {
  assert.equal(normalizeBaseUrl('acme.coupahost.com'), 'https://acme.coupahost.com/');
  assert.equal(normalizeBaseUrl(' https://acme.coupahost.com// '), 'https://acme.coupahost.com/');
});

test('parseCsv returns one object per row keyed by the header', () => {
  assert.deepEqual(parseCsv('a,b\n1,\n')[0], { a: '1', b: '' });
});

test('import credentials get the target client id and base url', () => {
  const p = run([
    hook('Imp', {
      settings: {
        credentials: { client_id: 'old', base_api_url: 'https://old/', client_scope: 's' },
      },
    }),
  ]);
  assert.deepEqual(p.ops[0].body.settings.credentials, {
    client_id: 'CID-NEW',
    base_api_url: 'https://acme-test.coupahost.com/',
    client_scope: 's',
  });
});

test('MDH Coupa auth gets the token url, client id and the invoices query url', () => {
  const settings = {
    configurations: [
      {
        source: {
          auth: { url: 'x', body: { client_id: 'old', scope: 's' } },
          queries: [{ url: 'q' }, { url: 'q2' }],
        },
      },
    ],
  };
  const src = run([hook('Plain', { settings })]).ops[0].body.settings.configurations[0].source;
  assert.equal(src.auth.url, 'https://acme-test.coupahost.com/oauth2/token');
  assert.deepEqual(src.auth.body, { client_id: 'CID-NEW', scope: 's' });
  assert.deepEqual(
    src.queries.map((q: any) => q.url),
    ['https://acme-test.coupahost.com/api/invoices/', 'q2'],
  );
});

test('top-level client_id and coupa_base_url are replaced only where present', () => {
  const p = run([
    hook('Plain', { settings: { client_id: 'old' } }),
    hook('Map', { settings: { coupa_base_url: 'old' } }),
  ]);
  assert.deepEqual(p.ops[0].body.settings, { client_id: 'CID-NEW' });
  assert.deepEqual(p.ops[1].body.settings, { coupa_base_url: 'https://acme-test.coupahost.com/' });
});

test('the region column of hooks.csv sets config.url', () => {
  assert.equal(run([hook('Map')], 'prod-us2').ops[0].body.config.url, 'https://us2');
  assert.equal(
    run([hook('Imp', { config: { url: 'keep' } })], 'prod-us2').ops[0].body.config.url,
    'keep',
  );
});

test('an unknown region is refused', () => {
  assert.throws(() => run([hook('Map')], 'prod-xx'), /region/);
});

test('a hook that needs the secret is created inactive and a patch adds the secret and its active flag', () => {
  const p = run([hook('Imp'), hook('Plain', { active: false })]);
  assert.equal(p.ops[0].body.active, false);
  assert.deepEqual(p.patches, [
    {
      key: 'hooks:Imp',
      type: 'hooks',
      body: { secrets: { client_secret: '$secret:client_secret' }, active: true },
    },
  ]);
  assert.ok(!JSON.stringify(p).includes('S3CRET')); // the value is given to the engine at run time only
});

test('invoke rows are listed for the post-deploy step', () => {
  assert.deepEqual(run([hook('Imp'), hook('Map')]).invoke, ['hooks:Imp']);
});

test('the schema Coupa fields get the target values as default and formula', () => {
  const schema = {
    key: 'schemas:1',
    type: 'schemas',
    body: {
      name: 'S',
      content: [
        {
          id: 'sec',
          children: [
            { id: 'oauth_client_id', default_value: 'old', formula: "'old'" },
            { id: 'coupa_api_base_url', default_value: 'old', formula: "'old'" },
            { id: 'other', default_value: 'x' },
          ],
        },
      ],
    },
  };
  const kids = run([schema]).ops[0].body.content[0].children;
  assert.deepEqual(kids[0], {
    id: 'oauth_client_id',
    default_value: 'CID-NEW',
    formula: "'CID-NEW'",
  });
  assert.deepEqual(kids[1], {
    id: 'coupa_api_base_url',
    default_value: 'https://acme-test.coupahost.com/',
    formula: "'https://acme-test.coupahost.com/'",
  });
  assert.deepEqual(kids[2], { id: 'other', default_value: 'x' });
});

test('configurePlan does not change its input plan', () => {
  const ops = [hook('Imp', { settings: { credentials: { client_id: 'old', base_api_url: 'b' } } })];
  run(ops);
  assert.equal(ops[0].body.settings.credentials.client_id, 'old');
});

test('real CIB v2.0.1 plan: no source Coupa tenant left, 20 secrets, 12 invokes, every csv hook found', () => {
  // the source tenant's Coupa hosts and client ids, as the release ships them ({field...} are references)
  const before = JSON.stringify(realPlan().ops);
  const srcHosts = [...new Set(before.match(/[a-z0-9-]+\.coupa(host|cloud)\.com/g))];
  const srcClients = [
    ...new Set([...before.matchAll(/"client_id":"([^"${][^"]*)"/g)].map((m) => m[1])),
  ];
  assert.ok(srcHosts.length && srcClients.length);
  const p = configurePlan(realPlan(), { coupa: COUPA, region: 'prod-eu', hooksCsv: realCsv });
  const txt = JSON.stringify(p.ops);
  for (const x of srcClients) assert.ok(!txt.includes(x), 'source client id left');
  for (const x of srcHosts) assert.ok(!txt.includes(x), 'source Coupa host left');
  assert.equal(p.patches.filter((x: any) => x.body.secrets).length, 20);
  assert.equal(p.invoke.length, 12);
  assert.equal(p.patches.length, 22); // 2 engine training_queues + 20 secret patches
  const names = new Set(p.ops.filter((o: any) => o.type === 'hooks').map((o: any) => o.body.name));
  assert.deepEqual(
    parseCsv(realCsv)
      .map((r) => r.hook_name)
      .filter((n) => !names.has(n)),
    [],
  );
});

test('real CIB v2.0.1 plan deploys into the fake API: all objects, secrets on, no hook live without its secret', async () => {
  const { fakeRossum } = await import('./support/fakeRossum.js');
  const { makeClient, deploy } = await import('../src/cib/engine.js');
  const f = fakeRossum();
  const p = configurePlan(realPlan(), { coupa: COUPA, region: 'prod-eu', hooksCsv: realCsv });
  const idmap = await deploy(makeClient(f.base, 'tok', f.fetch), {
    run: 'e2e',
    orgId: 1,
    ops: p.ops,
    patches: p.patches,
    secrets: { client_secret: 'S3CRET' },
  });
  assert.equal(Object.keys(idmap).length, CIB_V2_0_1_OBJECT_COUNT);
  const hooks = f.db.hooks;
  assert.equal(hooks.length, 33);
  assert.equal(hooks.filter((h) => h.secrets).length, 20);
  // a body that names a hook and makes it active, without the secret (the secret patch carries no name)
  const live = f.calls
    .filter((x) => x.url.includes('/hooks') && x.body?.name && x.body.active === true)
    .map((x) => x.body.name);
  const needSecret = new Set(
    parseCsv(realCsv)
      .filter((r) => r.patch_secret === 'true')
      .map((r) => r.hook_name),
  );
  assert.deepEqual(
    live.filter((n) => needSecret.has(n)),
    [],
  );
});

// Coupa returns the granted scopes only in the access_token JWT `scope` claim (deploy tool v1.3.3)
const jwt = (scope: string) =>
  `h.${Buffer.from(JSON.stringify({ scope })).toString('base64url')}.s`;
let coupaLast: any;
const coupaFetch = (status: number, body: unknown) =>
  (async (url: string, init: any) => {
    coupaLast = { url, init };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
const REQ = ['core.a.read', 'core.b.read'];

test('checkCoupa: valid token with all scopes is ok, extra scopes are listed', async () => {
  const { checkCoupa } = await import('../src/cib/cib.js');
  const r = await checkCoupa(
    coupaFetch(200, { access_token: jwt('core.a.read core.b.read core.x') }),
    COUPA,
    REQ,
  );
  assert.deepEqual(r, { status: 'ok', missing: [], extra: ['core.x'] });
  assert.equal(coupaLast.url, 'https://acme-test.coupahost.com/oauth2/token');
  const form = new URLSearchParams(coupaLast.init.body);
  assert.deepEqual(
    [form.get('grant_type'), form.get('client_id'), form.get('client_secret')],
    ['client_credentials', 'CID-NEW', 'S3CRET'],
  );
});

test('checkCoupa: missing scopes block', async () => {
  const { checkCoupa } = await import('../src/cib/cib.js');
  const r = await checkCoupa(coupaFetch(200, { access_token: jwt('core.a.read') }), COUPA, REQ);
  assert.deepEqual([r.status, r.missing], ['missing_scopes', ['core.b.read']]);
});

test("checkCoupa: a rejected credential is invalid and carries Coupa's answer", async () => {
  const { checkCoupa } = await import('../src/cib/cib.js');
  const r = await checkCoupa(coupaFetch(401, { error: 'invalid_client' }), COUPA, REQ);
  assert.equal(r.status, 'invalid');
  assert.match(r.detail!, /401.*invalid_client/);
});

test('checkCoupa: unreachable endpoint or opaque token is unchecked, not a block', async () => {
  const { checkCoupa } = await import('../src/cib/cib.js');
  const down = async () => {
    throw new TypeError('fetch failed');
  };
  assert.equal((await checkCoupa(down, COUPA, REQ)).status, 'unchecked');
  assert.equal(
    (await checkCoupa(coupaFetch(200, { access_token: 'opaque' }), COUPA, REQ)).status,
    'unchecked',
  );
});

// preflight: tool v1.3.3 check_target_org_empty, check_org_features, check_hook_templates, resolve_token_owner_id
const pre = async (
  setupFake: (f: FakeRossum) => void = () => {},
  plan: any = { ops: [hook('X', { config: { timeout_s: 360 } }), { ...hook('T'), template: 55 }] },
  tokenOwnerUsername?: string,
  region = 'prod-eu',
) => {
  const { fakeRossum } = await import('./support/fakeRossum.js');
  const { makeClient } = await import('../src/cib/engine.js');
  const { preflight } = await import('../src/cib/cib.js');
  const f = fakeRossum();
  setupFake(f);
  return preflight(makeClient(f.base, 'tok', f.fetch), plan, 1, { tokenOwnerUsername, region });
};

test('preflight: a clean org that meets every need has no blockers', async () => {
  assert.deepEqual((await pre()).blockers, []);
});

test('preflight: CIB objects in the org block, on any page; deletion_requested ones do not', async () => {
  const r = await pre((f: FakeRossum) => {
    f.db.rules = [...Array(230)]
      .map((_, i) => ({ id: i, name: `other ${i}` }))
      .concat([{ id: 99, name: 'Something (CIB)' }]);
    f.db.queues = [{ id: 5, name: 'AP Documents - BE', status: 'deletion_requested' }];
  });
  assert.equal(r.blockers.length, 1);
  assert.match(r.blockers[0], /1 rules: Something \(CIB\)/);
});

test('preflight: CIB schemas left over are only a note', async () => {
  const r = await pre((f: FakeRossum) => {
    f.db.schemas = [{ id: 5, name: 'AP Documents - BE' }];
  });
  assert.deepEqual(r.blockers, []);
  assert.ok(r.notes.some((n) => /1 CIB schema/.test(n)));
});

test('preflight: a region other than the organization group deployment location blocks', async () => {
  const r = await pre(() => {}, undefined, undefined, 'prod-eu2');
  assert.ok(r.blockers.some((b) => /region prod-eu2.*deployment location is prod-eu/.test(b)));
});

test('preflight: an unknown deployment location is only a note', async () => {
  const r = await pre(
    (f: FakeRossum) => {
      delete f.db.organization_groups[0].deployment_location;
    },
    undefined,
    undefined,
    'prod-eu2',
  );
  assert.deepEqual(r.blockers, []);
  assert.ok(r.notes.some((n) => /region prod-eu2 not checked/.test(n)));
});

test('preflight: a hook timeout above the org group cap blocks; no feature means 60 s', async () => {
  const r = await pre((f: FakeRossum) => {
    f.db.organization_groups[0].features = {};
  });
  assert.ok(r.blockers.some((b) => /360 s.*at most 60 s/.test(b)));
});

test('preflight: a Store template the org cannot see blocks', async () => {
  const r = await pre((f: FakeRossum) => {
    f.db.hook_templates = f.db.hook_templates.filter((t: any) => t.id !== 55);
  });
  assert.ok(r.blockers.some((b) => /hook_templates\/55.*T/.test(b)));
});

test('preflight: a token from another organization blocks; a non-admin is only a note', async () => {
  let r = await pre((f: FakeRossum) => {
    f.user.organization = `${f.api}/organizations/2`;
  });
  assert.ok(r.blockers.some((b) => /token owner/.test(b)));
  r = await pre((f: FakeRossum) => {
    f.user.groups = [`${f.api}/groups/2`];
  });
  assert.deepEqual(r.blockers, []);
  assert.ok(r.notes.some((n) => /not an admin/.test(n)));
});

// post-deploy: tool v1.3.3 handle_memorisation_datasets, the invoke column of handle_hooks, verify_imports
const post = async () => {
  const { fakeRossum } = await import('./support/fakeRossum.js');
  const { makeClient } = await import('../src/cib/engine.js');
  const f = fakeRossum();
  return { f, c: makeClient(f.base, 'tok', f.fetch), m: await import('../src/cib/cib.js') };
};

test('memorisation: 3 collections, each with the __dynamic_index; an existing one is not an error', async () => {
  const { f, c, m } = await post();
  f.collections.add('_tax_code_memorization');
  const r = await m.createMemorisation(c);
  assert.deepEqual([...f.collections].sort(), [
    '_customer_memorization_test',
    '_supplier_memorization_test',
    '_tax_code_memorization',
  ]);
  assert.deepEqual(
    f.indexes.map((i) => [i.collectionName, i.indexName, JSON.stringify(i.keys)]).sort()[0],
    ['_customer_memorization_test', '__dynamic_index', '{"$**":1}'],
  );
  assert.equal(r.filter((x) => x.ok).length, 5); // 2 creates + 3 indexes
});

test('memorisation names are the ones the real CIB v2.0.1 hooks use', async () => {
  const { MEMORISATION } = await import('../src/cib/cib.js');
  const used = new Set(JSON.stringify(realPlan().ops).match(/_[a-z_]*memorization[a-z_]*/g));
  assert.deepEqual([...used].sort(), [...MEMORISATION].sort());
});

test('invokeImports calls invoke on the target hook of each key; a failure is reported, the rest still run', async () => {
  const { f, c, m } = await post();
  f.db.hooks = [
    { id: 7, name: 'A' },
    { id: 8, name: 'B' },
  ];
  f.fail.push({ method: 'POST', match: /\/hooks\/7\/invoke$/, status: 500, times: 1 });
  const r = await m.invokeImports(c, { 'hooks:a': { id: 7 }, 'hooks:b': { id: 8 } }, [
    'hooks:a',
    'hooks:b',
  ]);
  assert.deepEqual(
    r.map((x) => [x.key, x.status]),
    [
      ['hooks:a', 500],
      ['hooks:b', 200],
    ],
  );
});

test('importDatasets reads import_config.dataset_name of the invoke hooks', async () => {
  const { importDatasets } = await import('../src/cib/cib.js');
  const p = configurePlan(realPlan(), { coupa: COUPA, region: 'prod-eu', hooksCsv: realCsv });
  const d = importDatasets(p);
  assert.equal(Object.keys(d).length, 12);
  assert.equal(d.suppliers_test, 'Coupa Master Data Import - Suppliers (CIB)');
});

test('waitImports: done when every dataset or its __tmp_ copy exists; else pending after the wait', async () => {
  const { f, c, m } = await post();
  const sleeps: number[] = [];
  f.collections.add('a');
  f.collections.add('__tmp_b_123');
  assert.deepEqual(
    await m.waitImports(c, ['a', 'b'], { waitS: 60, pollS: 20, sleep: (s) => sleeps.push(s) }),
    [],
  );
  assert.deepEqual(
    await m.waitImports(c, ['a', 'z'], { waitS: 60, pollS: 20, sleep: (s) => sleeps.push(s) }),
    ['z'],
  );
  assert.deepEqual(sleeps, [20, 20, 20]);
});

// the whole CIB deploy in the order of tool v1.3.3 deploy_cib(), against the fake API
const full = async (setupFake: (f: FakeRossum) => void = () => {}) => {
  const { f, c, m } = await post();
  f.onInvoke = (h) => f.collections.add(h.settings.import_config.dataset_name);
  setupFake(f);
  const opts = {
    plan: realPlan(),
    orgId: 1,
    run: 'r1',
    coupa: COUPA,
    region: 'prod-eu',
    hooksCsv: realCsv,
    requiredScopes: REQ,
    coupaFetch: coupaFetch(200, { access_token: jwt(REQ.join(' ')) }),
    waitOpts: { sleep: () => {} },
  };
  return { f, c, m, opts };
};

test('deployCib: real plan, clean org -> all objects, memorisation, 12 invokes, every import landed', async () => {
  const { f, c, m, opts } = await full();
  const r = await m.deployCib(c, opts);
  assert.equal(r.status, 'done');
  assert.equal(Object.keys(r.idmap!).length, CIB_V2_0_1_OBJECT_COUNT);
  assert.equal(r.invoked!.filter((x) => x.status === 200).length, 12);
  assert.deepEqual(r.pendingImports, []);
  assert.equal(f.collections.size, 3 + 12);
});

test('deployCib: a Coupa or preflight blocker stops it before anything is created', async () => {
  let { f, c, m, opts } = await full();
  let r = await m.deployCib(c, {
    ...opts,
    coupaFetch: coupaFetch(401, { error: 'invalid_client' }),
  });
  assert.equal(r.status, 'blocked');
  ({ f, c, m, opts } = await full((f: FakeRossum) => {
    f.db.hooks = [{ id: 1, name: 'MDH - Main (CIB)' }];
  }));
  r = await m.deployCib(c, opts);
  assert.equal(r.status, 'blocked');
  assert.equal(
    f.calls.filter((x) => x.method !== 'GET' && !x.url.includes('/data/find')).length,
    0,
  );
});

test('deployCib: a resumed run skips the preflight (its own objects are there) and finishes', async () => {
  const { f, c, m, opts } = await full();
  f.fail.push({ method: 'POST', match: /\/rules$/, status: 500, times: 1 });
  await assert.rejects(m.deployCib(c, opts), /failed: 500/);
  const r = await m.deployCib(c, opts);
  assert.equal(r.status, 'done');
  assert.equal(f.db.hooks.length, 33);
});

test('deployCib: the Coupa secret never reaches the Data Storage checkpoint, but reaches the hooks', async () => {
  const { f, c, m, opts } = await full();
  await m.deployCib(c, opts);
  assert.ok(!JSON.stringify(f.ds).includes('S3CRET'));
  assert.equal(f.db.hooks.filter((h) => h.secrets?.client_secret === 'S3CRET').length, 20);
});

// a group-admin caller (seen on a test org, 2026-10-19: caller in another org, role organization_group_admin)
// deploys with a named local admin as hook token owner, like tool v1.3.3 token_owner_username
const groupAdminCaller = (f: FakeRossum) => {
  f.user.organization = `${f.api}/organizations/3`;
  f.user.groups = [`${f.api}/groups/6`];
  f.db.users = [
    {
      id: 50,
      url: `${f.api}/users/50`,
      username: 'local@x',
      organization: `${f.api}/organizations/1`,
      groups: [`${f.api}/groups/3`],
    },
    {
      id: 51,
      url: `${f.api}/users/51`,
      username: 'far@x',
      organization: `${f.api}/organizations/2`,
      groups: [`${f.api}/groups/3`],
    },
  ];
};

test('preflight: a group-admin caller with a local admin token owner has no blockers', async () => {
  const r = await pre(groupAdminCaller, undefined, 'local@x');
  assert.deepEqual(r.blockers, []);
});

test('preflight: a token owner that is unknown or from another organization blocks', async () => {
  assert.ok(
    (await pre(groupAdminCaller, undefined, 'nobody@x')).blockers.some((b) =>
      /token owner 'nobody@x'/.test(b),
    ),
  );
  assert.ok(
    (await pre(groupAdminCaller, undefined, 'far@x')).blockers.some((b) =>
      /token owner 'far@x'/.test(b),
    ),
  );
});

test('deployCib: hooks get the named local token owner', async () => {
  const { f, c, m, opts } = await full(groupAdminCaller);
  const r = await m.deployCib(c, { ...opts, tokenOwnerUsername: 'local@x' });
  assert.equal(r.status, 'done');
  assert.ok(f.db.hooks.every((h) => h.token_owner === `${f.api}/users/50`));
});

test('readRequiredScopes takes the scope names (the keys); a malformed file gives none', async () => {
  const { readRequiredScopes } = await import('../src/cib/cib.js');
  const file = JSON.stringify({ _comment: 'x', required_scopes: { 'core.a.read': 'suppliers' } });
  assert.deepEqual(readRequiredScopes(file), ['core.a.read']);
  assert.deepEqual(readRequiredScopes(`ok, ${file}`), []);
  assert.ok(REL.requiredScopes.includes('core.invoice.create')); // the real v2.0.1 file
});

test('real plan: a second run with a new run id adopts every object and creates nothing', async () => {
  const { f, c, m, opts } = await full();
  await m.deployCib(c, opts);
  const posts = () =>
    f.calls.filter(
      (x) => x.method === 'POST' && x.url.startsWith(f.api) && !x.url.endsWith('/invoke'),
    ).length;
  const before = posts();
  const r = await m.deployCib(c, { ...opts, run: 'r2' });
  assert.equal(r.status, 'blocked'); // preflight sees the CIB objects: a new run is a fresh install
  const { deploy } = await import('../src/cib/engine.js');
  const p = configurePlan(realPlan(), { coupa: COUPA, region: 'prod-eu', hooksCsv: realCsv });
  await deploy(c, {
    run: 'r3',
    orgId: 1,
    ops: p.ops,
    patches: p.patches,
    secrets: { client_secret: 'x' },
  });
  assert.equal(posts(), before);
});

test('deployCib allowExisting: continues a half-built deploy under a new run id, adopting what is there', async () => {
  const { f, c, m, opts } = await full();
  f.fail.push({ method: 'POST', match: /\/queues$/, status: 400, times: 1 });
  await assert.rejects(m.deployCib(c, opts), /failed: 400/);
  const r = await m.deployCib(c, { ...opts, run: 'r2', allowExisting: true });
  assert.equal(r.status, 'done');
  assert.ok(r.notes.some((n) => /CIB objects/.test(n)));
  assert.equal(f.db.hooks.length, 33);
  assert.equal(f.db.engine_fields.length, 104);
  assert.equal(f.db.hooks.filter((h) => h.secrets).length, 20);
});

test('deployCib checkOnly: runs the read-only checks, writes nothing, says ready or blocked', async () => {
  let { f, c, m, opts } = await full();
  let r = await m.deployCib(c, { ...opts, checkOnly: true });
  assert.equal(r.status, 'ready');
  assert.equal(
    f.calls.filter((x) => x.method !== 'GET' && !x.url.includes('/data/find')).length,
    0,
  );
  ({ f, c, m, opts } = await full((f: FakeRossum) => {
    f.db.hooks = [{ id: 1, name: 'MDH - Main (CIB)' }];
  }));
  r = await m.deployCib(c, { ...opts, checkOnly: true });
  assert.equal(r.status, 'blocked');
});

test('deployCib checkOnly on a run with a checkpoint: says resumable, writes nothing', async () => {
  const { f, c, m, opts } = await full();
  f.fail.push({ method: 'POST', match: /\/rules$/, status: 500, times: 1 });
  await assert.rejects(m.deployCib(c, opts), /failed: 500/);
  const n = f.calls.length;
  const r = await m.deployCib(c, { ...opts, checkOnly: true });
  assert.equal(r.status, 'resumable');
  assert.equal(
    f.calls.slice(n).filter((x) => x.method !== 'GET' && !x.url.includes('/data/find')).length,
    0,
  );
});

// MDH watermark: ${last_modified_date} resumes from the last finished operation per (org, dataset_name),
// which a teardown cannot clear (seen on two test orgs, 13 Oct 2026)
const ANCHOR = '${last_modified_date}',
  EPOCH = '1970-01-01T00:00:00Z';
const supplierHook = (f: FakeRossum) =>
  f.db.hooks.find((h: any) => h.settings?.import_config?.dataset_name === 'suppliers_test');

test('redeploy: a dataset with a finished MDH operation gets one import from the epoch, then the anchor is restored', async () => {
  const { f, c, m, opts } = await full((f: FakeRossum) => {
    f.mdh.suppliers_test = [
      { operation_id: 'old', status: 'finished', create_ts: '2026-10-19T12:40:00Z' },
    ];
  });
  const r = await m.deployCib(c, opts);
  assert.equal(r.status, 'done');
  const job = f.mdh.suppliers_test.find((o) => o.operation_id !== 'old');
  assert.ok(Object.values(job.query).includes(EPOCH)); // the job ran from the epoch
  assert.ok(Object.values(supplierHook(f).settings.import_config.query).includes(ANCHOR)); // and the hook is back on the anchor
  assert.equal(r.invoked!.filter((x) => x.seeded).map((x) => x.key).length, 1);
});

test('no seeding without a finished operation: a fresh dataset or one with only failed runs keeps the anchor for its job', async () => {
  const { f, c, m, opts } = await full((f: FakeRossum) => {
    f.mdh.tax_codes_test = [
      { operation_id: 'x', status: 'failed', create_ts: '2026-10-19T12:40:00Z' },
    ];
  });
  const r = await m.deployCib(c, opts);
  assert.equal(r.invoked!.filter((x) => x.seeded).length, 0);
  for (const ops of Object.values(f.mdh))
    for (const o of ops.filter((o) => o.query)) assert.ok(!Object.values(o.query).includes(EPOCH));
});

test('deployCib onProgress: checks -> objects -> patches -> memorisation -> imports -> datasets, objects end at CIB_V2_0_1_OBJECT_COUNT/CIB_V2_0_1_OBJECT_COUNT', async () => {
  const { c, m, opts } = await full();
  const p: any[] = [];
  await m.deployCib(c, { ...opts, onProgress: (x) => p.push(x) });
  const phases = [...new Set(p.map((x) => x.phase))];
  assert.deepEqual(phases, ['checks', 'objects', 'patches', 'memorisation', 'imports', 'datasets']);
  assert.equal(p.filter((x) => x.phase === 'objects').at(-1).done, CIB_V2_0_1_OBJECT_COUNT);
  assert.equal(p.filter((x) => x.phase === 'imports').at(-1).done, 12);
});

test('every CIB release on GitHub deploys into a clean fake org', async () => {
  for (const v of ['v1.0.0', 'v1.1.0', 'v2.0.0', 'v2.0.1']) {
    const { plan, hooksCsv, requiredScopes } = await realRelease(v);
    const { f, c, m, opts } = await full();
    const r = await m.deployCib(c, {
      ...opts,
      plan,
      hooksCsv,
      requiredScopes,
      coupaFetch: undefined,
    });
    assert.equal(r.status, 'done', v);
    assert.equal(f.db.hooks.length, plan.ops.filter((o: any) => o.type === 'hooks').length, v);
    assert.deepEqual(r.pendingImports, [], v);
  }
});

// the Coupa check from a deployed function hook: the fake answers the invoke with `answer`;
// `wrap` may put a layer over the fake's fetch
const viaFunction = async (answer: unknown, wrap = (x: typeof fetch) => x) => {
  const { f, m } = await post();
  const { makeClient } = await import('../src/cib/engine.js');
  const invokes: any[] = [];
  f.onInvoke = (h) => (invokes.push(structuredClone(h)), answer);
  const c = makeClient(f.base, 'tok', wrap(f.fetch), { sleep: () => {} });
  const h = await m.deployCoupaProbe(c);
  const r = await m.checkCoupaViaFunction(c, h.url, COUPA, REQ, { sleep: () => {} });
  return { f, c, m, h, r, invokes };
};

test('Coupa check function: deploy once, the secret only in the hook secrets, scopes judged, it stays until torn down', async () => {
  const { f, c, m, h, r, invokes } = await viaFunction({
    http_status: 200,
    scope: 'core.a.read core.b.read core.x',
  });
  assert.deepEqual(r, { status: 'ok', missing: [], extra: ['core.x'] });
  assert.equal(h.type, 'function');
  assert.equal(invokes[0].secrets.client_secret, 'S3CRET');
  const call = f.calls.find((x) => x.url.endsWith('/invoke'));
  assert.deepEqual(call.body, {
    token_url: 'https://acme-test.coupahost.com/oauth2/token',
    client_id: 'CID-NEW',
  });
  assert.equal((await m.deployCoupaProbe(c)).url, h.url); // a second deploy re-uses it
  assert.equal(f.db.hooks.length, 1);
  assert.equal(await m.teardownCoupaProbes(c), 1);
  assert.equal(f.db.hooks.length, 0);
  assert.equal(await m.teardownCoupaProbes(c), 0);
});

test('Coupa check function: a hook with the same name but other code never gets the secret', async () => {
  const { f, c, m } = await post();
  for (const body of [
    { type: 'function', config: { runtime: 'python3.12', code: 'steal()' } },
    { type: 'webhook', config: { url: 'https://evil.example/' } },
  ])
    await c.call('POST', 'hooks', {
      name: m.COUPA_PROBE_NAME,
      events: ['invocation.manual'],
      queues: [],
      active: true,
      ...body,
    });
  const planted = f.db.hooks.map((h) => h.url);
  assert.deepEqual(await m.findCoupaProbes(c), []);
  for (const url of planted) {
    const r = await m.checkCoupaViaFunction(c, url, COUPA, REQ, { sleep: () => {} });
    assert.equal(r.status, 'unchecked');
    assert.match(r.detail!, /not the check function/);
  }
  assert.ok(!f.calls.some((x) => x.method === 'PATCH' || x.url.endsWith('/invoke')));
  const own = await m.deployCoupaProbe(c);
  assert.ok(!planted.includes(own.url)); // a new one, not a planted one
  assert.equal(await m.teardownCoupaProbes(c), 1); // the planted hooks stay
});

test('Coupa check function: rejected -> invalid, unreachable -> unchecked, missing scopes listed', async () => {
  assert.equal(
    (await viaFunction({ http_status: 401, error: 'invalid_client' })).r.status,
    'invalid',
  );
  const blocked = (await viaFunction({ error: 'URLError: timed out' })).r;
  assert.equal(blocked.status, 'unchecked');
  assert.match(blocked.detail!, /HTTPS/);
  assert.deepEqual((await viaFunction({ http_status: 200, scope: 'core.a.read' })).r.missing, [
    'core.b.read',
  ]);
});

test('Coupa check function: waits while the function builds and retries FunctionNotReady', async () => {
  let pending = 2,
    notReady = 1;
  const { r } = await viaFunction(
    { http_status: 200, scope: REQ.join(' ') },
    (orig) =>
      (async (url: string, init: any) => {
        if (/\/hooks\/\d+$/.test(url) && init?.method === 'GET' && pending-- > 0) {
          const h = await (await orig(url, init)).json(); // the whole hook, still building
          return new Response(JSON.stringify({ ...h, config: { ...h.config, status: 'pending' } }));
        }
        if (url.endsWith('/invoke') && notReady-- > 0)
          return new Response(JSON.stringify({ detail: 'FunctionNotReadyException' }), {
            status: 400,
          });
        return orig(url, init);
      }) as typeof fetch,
  );
  assert.equal(r.status, 'ok');
  assert.ok(pending < 0 && notReady < 0); // both stages were passed through
});

test('deployCib with coupaProbe: rejected credentials block before anything is created', async () => {
  const { f, c, m, opts } = await full();
  const h = await m.deployCoupaProbe(c);
  f.onInvoke = () => ({ http_status: 401, error: 'invalid_client' });
  const r = await m.deployCib(c, { ...opts, coupaFetch: undefined, coupaProbe: h.url });
  assert.equal(r.status, 'blocked');
  assert.match(r.blockers![0], /Coupa rejected/);
  assert.deepEqual(
    f.db.hooks.map((x) => x.name),
    [m.COUPA_PROBE_NAME],
  );
});

test('a complete deploy deletes its checkpoint; with imports pending it stays and the same run ID re-runs only the imports', async () => {
  const plans = (f: FakeRossum) => f.ds.filter((d) => d.doc.kind === 'plan');
  let { f, c, m, opts } = await full();
  let r = await m.deployCib(c, opts);
  assert.deepEqual([r.status, r.pendingImports, plans(f).length], ['done', [], 0]);
  assert.ok(r.notes.some((n) => /checkpoint is deleted/.test(n)));

  ({ f, c, m, opts } = await full((f: FakeRossum) => {
    f.onInvoke = () => undefined; // the imports start but no dataset fills
  }));
  r = await m.deployCib(c, opts);
  assert.equal(r.pendingImports!.length, 12);
  assert.equal(plans(f).length, 1);
  assert.ok(r.notes.some((n) => /stays in Data Storage/.test(n)));
  const posts = f.calls.length;
  f.onInvoke = (h) => f.collections.add(h.settings.import_config.dataset_name);
  r = await m.deployCib(c, opts); // same run ID
  assert.deepEqual([r.status, r.pendingImports, plans(f).length], ['done', [], 0]);
  const again = f.calls.slice(posts).filter((x) => x.method === 'POST' && x.url.startsWith(f.api));
  assert.ok(again.every((x) => x.url.endsWith('/invoke'))); // no object created a second time
});
