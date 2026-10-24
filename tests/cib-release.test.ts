import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  compilePlan,
  listReleases,
  loadRelease,
  CIB_REPO,
  TOOL_REPO,
  TOOL_REF,
  TOOL_REFS,
} from '../src/cib/release.js';

// a small synthetic prd2 org folder: one engine, workspace, queue, two hooks (one from a template), one rule
const S = 'https://src.example.com/api/v1';
const org = () =>
  new Map<string, any>(
    Object.entries({
      '../organization.json': { id: 7 },
      'engines/E/engine.json': {
        id: 1,
        url: `${S}/engines/1`,
        name: 'E',
        training_queues: [`${S}/queues/30`],
        agenda_id: 'a',
      },
      'engines/E/engine_fields/f.json': {
        id: 2,
        url: `${S}/engine_fields/2`,
        engine: `${S}/engines/1`,
        name: 'f',
      },
      'workspaces/W/workspace.json': {
        id: 10,
        url: `${S}/workspaces/10`,
        name: 'W',
        organization: `${S}/organizations/7`,
        queues: [`${S}/queues/30`],
      },
      'workspaces/W/queues/Q/queue.json': {
        id: 30,
        url: `${S}/queues/30`,
        name: 'Q',
        workspace: `${S}/workspaces/10`,
        schema: `${S}/schemas/40`,
        inbox: `${S}/inboxes/50`,
        hooks: [`${S}/hooks/21`],
        webhooks: [`${S}/webhooks/21`],
        counts: {},
      },
      'workspaces/W/queues/Q/schema.json': {
        id: 40,
        url: `${S}/schemas/40`,
        name: 'Q schema',
        queues: [`${S}/queues/30`],
      },
      'workspaces/W/queues/Q/inbox.json': {
        id: 50,
        url: `${S}/inboxes/50`,
        name: 'Q inbox',
        email: 'q@x',
        queues: [`${S}/queues/30`],
      },
      'hooks/a b.json': {
        id: 21,
        url: `${S}/hooks/21`,
        name: 'A',
        run_after: [`${S}/hooks/20`],
        queues: [`${S}/queues/30`],
        status: 'ok',
        config: { code: 'x' },
      },
      'hooks/b.json': {
        id: 20,
        url: `${S}/hooks/20`,
        name: 'B',
        type: 'webhook',
        run_after: [],
        hook_template: `${S}/hook_templates/55`,
        config: { private: true, code: 'c', runtime: 'python3.12', schedule: { cron: '1' } },
      },
      'rules/r.json': {
        id: 60,
        url: `${S}/rules/60`,
        name: 'R',
        organization: `${S}/organizations/7`,
        queues: [`${S}/queues/30`],
      },
    }),
  );
const compile = (files = org()) => compilePlan(files, { sourceUrl: `${S}/`, release: 'v9' });
const op = (plan: any, key: string) => plan.ops.find((o: any) => o.key === key);

test('compilePlan: create order, placeholders, dropped fields, engine patch', () => {
  const p = compile();
  assert.deepEqual(
    p.ops.map((o: any) => o.key),
    [
      'engines:1',
      'engine_fields:2',
      'workspaces:10',
      'hooks:20', // before hooks:21, which runs after it
      'hooks:21',
      'schemas:40',
      'queues:30',
      'inboxes:50',
      'rules:60',
    ],
  );
  assert.deepEqual(op(p, 'engines:1').body, { name: 'E', organization: '$org' });
  assert.deepEqual(p.patches, [
    { key: 'engines:1', type: 'engines', body: { training_queues: ['$ref:queues:30'] } },
  ]);
  assert.deepEqual(op(p, 'engine_fields:2').match, { engine: '$ref:engines:1', name: 'f' });
  assert.deepEqual(op(p, 'workspaces:10').body, { name: 'W', organization: '$org' });
  assert.deepEqual(op(p, 'queues:30').body, {
    name: 'Q',
    workspace: '$ref:workspaces:10',
    schema: '$ref:schemas:40',
    hooks: ['$ref:hooks:21'],
  });
  assert.deepEqual(op(p, 'schemas:40').body, { name: 'Q' });
  assert.deepEqual(op(p, 'inboxes:50').body, { name: 'Q', queues: ['$ref:queues:30'] });
  assert.equal(p.source_url, S);
  assert.equal(p.release, 'v9');
});

test('compilePlan: hooks get the token owner and no queues; a template hook keeps only its own config', () => {
  const p = compile();
  const a = op(p, 'hooks:21'),
    b = op(p, 'hooks:20');
  assert.deepEqual(a.body.run_after, ['$ref:hooks:20']);
  assert.deepEqual(
    [a.body.queues, a.body.token_owner, a.body.status],
    [[], '$token_owner', undefined],
  );
  assert.equal(b.template, 55);
  assert.equal(b.body.type, undefined);
  assert.deepEqual(b.body.config, { schedule: { cron: '1' } });
});

test('compilePlan refuses a plan that still points at the source org', () => {
  const outside = org();
  outside.get('hooks/b.json').run_after = [`${S}/hooks/99`];
  assert.throws(() => compile(outside), /run_after to a hook outside the release/);
  const left = org();
  left.get('rules/r.json').settings = { u: `${S}/queues/999` };
  assert.throws(() => compile(left), /source host .* is still in it/);
});

// a fake GitHub: the API tree of the release plus raw files
const github = (withDeploy: boolean) => {
  const root = 'cib-org/default',
    files: Record<string, string> = {};
  for (const [p, v] of org())
    files[p === '../organization.json' ? 'cib-org/organization.json' : `${root}/${p}`] =
      JSON.stringify(v);
  files[`${root}/hooks/a b.py`] = 'x'; // not part of the plan, never read
  const deploy = {
    'cib_target.yaml': `source_dir: ${withDeploy ? root : 'cib/cib'}\nsource_url: ${S}\n`,
    'hooks.csv': 'hook_name,invoke\nA,true\n',
    'required_scopes.json': '{"required_scopes": {"core.a.read": "x"}}',
  };
  const raw: Record<string, string> = {};
  for (const [p, v] of Object.entries(files)) raw[`${CIB_REPO}/v9/${p}`] = v;
  for (const [n, v] of Object.entries(deploy))
    if (withDeploy) ((raw[`${CIB_REPO}/v9/deploy/${n}`] = v), (files[`deploy/${n}`] = v));
    else raw[`${TOOL_REPO}/${TOOL_REF}/_config/${n}`] = v;
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url === `https://api.github.com/repos/${CIB_REPO}/git/trees/v9?recursive=1`)
      return new Response(
        JSON.stringify({
          truncated: false,
          tree: Object.keys(files).map((path) => ({ path, type: 'blob' })),
        }),
      );
    const p = decodeURIComponent(url.replace('https://raw.githubusercontent.com/', ''));
    return p in raw ? new Response(raw[p]) : new Response('404', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, urls };
};

test('loadRelease: v2.x layout reads deploy/ of the release and compiles the org folder', async () => {
  const { fetchImpl, urls } = github(true);
  const seen: any[] = [];
  const r = await loadRelease('v9', { fetchImpl, onProgress: (x) => seen.push(x) });
  assert.deepEqual(r.plan, compile());
  assert.equal(r.hooksCsv, 'hook_name,invoke\nA,true\n');
  assert.deepEqual(r.requiredScopes, ['core.a.read']);
  assert.equal(r.deployConfig, `${CIB_REPO}@v9/deploy`);
  assert.ok(urls.some((u) => u.endsWith('/hooks/a%20b.json'))); // path segments are encoded
  assert.ok(!urls.some((u) => u.endsWith('.py')));
  assert.equal(seen.at(-1).done, seen.at(-1).total);
});

test('loadRelease: v1.x layout (no deploy/) takes the deploy tool _config/ and finds the org folder', async () => {
  const { fetchImpl } = github(false);
  const r = await loadRelease('v9', { fetchImpl });
  assert.deepEqual(r.plan, compile());
  assert.equal(r.deployConfig, `${TOOL_REPO}@${TOOL_REF}/_config`);
});

test('loadRelease: a v1.x release takes the deploy tool version given, and only a supported one', async () => {
  assert.ok(TOOL_REFS.includes(TOOL_REF));
  const { fetchImpl, urls } = github(false);
  await loadRelease('v9', { fetchImpl, toolRef: TOOL_REF });
  assert.ok(urls.some((u) => u.includes(`/${TOOL_REPO}/${TOOL_REF}/_config/hooks.csv`)));
  await assert.rejects(
    loadRelease('v9', { fetchImpl, toolRef: 'v0.0.1' }),
    /v0\.0\.1 is not a supported deploy tool version/,
  );
});

test('loadRelease and listReleases report GitHub errors; listReleases skips drafts and pre-releases', async () => {
  const limited = (async () => new Response('limit', { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(loadRelease('v9', { fetchImpl: limited }), /403.*60 calls per hour/);
  const list = (async () =>
    new Response(
      JSON.stringify([
        { tag_name: 'v3', draft: true },
        { tag_name: 'v2.1', prerelease: true },
        { tag_name: 'v2' },
        { tag_name: 'v1' },
      ]),
    )) as unknown as typeof fetch;
  assert.deepEqual(await listReleases(list), ['v2', 'v1']);
});
