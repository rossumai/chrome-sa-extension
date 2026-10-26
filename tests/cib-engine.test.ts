import { test } from 'vitest';
import assert from 'node:assert/strict';
import { makeClient, deploy } from '../src/cib/engine.js';
import { fakeRossum } from './support/fakeRossum.js';
import type { FakeRossum } from './support/fakeRossum.js';

const ORG = 42;
const setup = () => {
  const f = fakeRossum();
  return { f, c: makeClient(f.base, 'tok', f.fetch) };
};
const posts = (f: FakeRossum, path: string) =>
  f.calls.filter((x: any) => x.method === 'POST' && x.url.endsWith(path));

const wsQueue = [
  {
    key: 'ws',
    type: 'workspaces',
    body: { name: 'W', organization: '$org' },
    match: { name: 'W' },
  },
  { key: 'q', type: 'queues', body: { name: 'Q', workspace: '$ref:ws' }, match: { name: 'Q' } },
];

test('creates ops in order and resolves $org and $ref', async () => {
  const { f, c } = setup();
  const idmap = await deploy(c, { run: 'r', orgId: ORG, ops: wsQueue });
  assert.equal(f.db.queues[0].workspace, idmap.ws.url);
  assert.equal(f.db.workspaces[0].organization, `${f.api}/organizations/${ORG}`);
});

test('adopts an existing object by match instead of creating it', async () => {
  const { f, c } = setup();
  f.db.workspaces = [{ id: 7, url: `${f.api}/workspaces/7`, name: 'W' }];
  const idmap = await deploy(c, { run: 'r', orgId: ORG, ops: wsQueue });
  assert.equal(idmap.ws.id, 7);
  assert.equal(posts(f, '/workspaces').length, 0);
});

test('resumes from the checkpoint after a failure and does not create twice', async () => {
  const { f, c } = setup();
  f.fail.push({ method: 'POST', match: /\/queues$/, status: 500, times: 1 });
  await assert.rejects(deploy(c, { run: 'r', orgId: ORG, ops: wsQueue }), /create q failed: 500/);
  await deploy(c, { run: 'r', orgId: ORG, ops: wsQueue });
  assert.equal(f.db.workspaces.length, 1);
  assert.equal(f.db.queues.length, 1);
});

test('resolves $token_owner to the deploying user', async () => {
  const { f, c } = setup();
  await deploy(c, {
    run: 'r',
    orgId: ORG,
    ops: [{ key: 'h', type: 'hooks', body: { name: 'H', token_owner: '$token_owner' } }],
  });
  assert.equal(f.db.hooks[0].token_owner, `${f.api}/users/1`);
});

test('creates a template hook through /hooks/create, then patches the body on it', async () => {
  const { f, c } = setup();
  const op = {
    key: 'h',
    type: 'hooks',
    template: 55,
    match: { name: 'Imp' },
    body: {
      name: 'Imp',
      active: false,
      settings: { a: 1 },
      config: { schedule: { cron: '0 5 * * *' } },
      queues: [],
    },
  };
  await deploy(c, { run: 'r', orgId: ORG, ops: [op] });
  const [call] = posts(f, '/hooks/create');
  assert.equal(call.body.hook_template, `${f.api}/hook_templates/55`);
  assert.equal(call.body.active, false); // never live between create and patch
  const h = f.db.hooks[0];
  assert.equal(h.type, 'job');
  assert.deepEqual(h.settings, { a: 1 });
  assert.deepEqual(h.config.schedule, { cron: '0 5 * * *' });
});

test('applies patches after all creates, with $ref resolved, and only once', async () => {
  const { f, c } = setup();
  const ops = [
    { key: 'e', type: 'engines', body: { name: 'E' }, match: { name: 'E' } },
    ...wsQueue,
  ];
  const patches = [{ key: 'e', type: 'engines', body: { training_queues: ['$ref:q'] } }];
  const idmap = await deploy(c, { run: 'r', orgId: ORG, ops, patches });
  assert.deepEqual(f.db.engines[0].training_queues, [idmap.q.url]);
  await deploy(c, { run: 'r', orgId: ORG, ops, patches });
  assert.equal(f.calls.filter((x) => x.method === 'PATCH').length, 1);
});

test('adopts by a match that holds a $ref (same field name on two engines)', async () => {
  const { f, c } = setup();
  const ops = [
    { key: 'e1', type: 'engines', body: { name: 'E1' }, match: { name: 'E1' } },
    { key: 'e2', type: 'engines', body: { name: 'E2' }, match: { name: 'E2' } },
    {
      key: 'f1',
      type: 'engine_fields',
      body: { engine: '$ref:e1', name: 'x' },
      match: { engine: '$ref:e1', name: 'x' },
    },
    {
      key: 'f2',
      type: 'engine_fields',
      body: { engine: '$ref:e2', name: 'x' },
      match: { engine: '$ref:e2', name: 'x' },
    },
  ];
  await deploy(c, { run: 'r1', orgId: ORG, ops });
  const idmap = await deploy(c, { run: 'r2', orgId: ORG, ops }); // fresh run, everything exists
  assert.equal(f.db.engine_fields.length, 2);
  assert.notEqual(idmap.f1.id, idmap.f2.id);
  assert.equal(f.db.engine_fields.find((x) => x.id === idmap.f2.id).engine, idmap.e2.url);
});

test('a template hook whose body patch failed gets the body on the resume', async () => {
  const { f, c } = setup();
  const op = {
    key: 'h',
    type: 'hooks',
    template: 55,
    match: { name: 'Imp' },
    body: { name: 'Imp', settings: { a: 1 } },
  };
  f.fail.push({ method: 'PATCH', match: /\/hooks\/\d+$/, status: 500, times: 1 });
  await assert.rejects(deploy(c, { run: 'r', orgId: ORG, ops: [op] }), /create h failed: 500/);
  await deploy(c, { run: 'r', orgId: ORG, ops: [op] });
  assert.equal(f.db.hooks.length, 1);
  assert.deepEqual(f.db.hooks[0].settings, { a: 1 });
});

test('$secret:<name> is resolved from the secrets argument and never stored in the checkpoint', async () => {
  const { f, c } = setup();
  const ops = [{ key: 'h', type: 'hooks', body: { name: 'H' } }];
  const patches = [
    { key: 'h', type: 'hooks', body: { secrets: { client_secret: '$secret:client_secret' } } },
  ];
  await deploy(c, { run: 'r', orgId: ORG, ops, patches, secrets: { client_secret: 'pw' } });
  assert.deepEqual(f.db.hooks[0].secrets, { client_secret: 'pw' });
  assert.ok(!JSON.stringify(f.ds).includes('"pw"'));
});

test('tokenOwner, when given, is used for $token_owner instead of the caller', async () => {
  const { f, c } = setup();
  await deploy(c, {
    run: 'r',
    orgId: ORG,
    tokenOwner: `${f.api}/users/77`,
    ops: [{ key: 'h', type: 'hooks', body: { name: 'H', token_owner: '$token_owner' } }],
  });
  assert.equal(f.db.hooks[0].token_owner, `${f.api}/users/77`);
});

test('the checkpoint lives in the _cib_deploy_runs collection', async () => {
  const { f, c } = setup();
  await deploy(c, { run: 'r', orgId: ORG, ops: wsQueue });
  assert.deepEqual([...new Set(f.ds.map((d) => d.collectionName))], ['_cib_deploy_runs']);
});

test('429: the call waits and retries (Retry-After when given), so a rate limit does not stop the deploy', async () => {
  const f = fakeRossum(),
    waits: number[] = [];
  const c = makeClient(f.base, 'tok', f.fetch, { sleep: (s) => waits.push(s) });
  f.fail.push({ method: 'POST', match: /\/queues$/, status: 429, times: 3 });
  const idmap = await deploy(c, { run: 'r', orgId: ORG, ops: wsQueue });
  assert.ok(idmap.q.id);
  assert.deepEqual(waits, [1, 2, 4]);
});

test('429 that never ends: gives up after 6 tries and reports the 429', async () => {
  const f = fakeRossum();
  const c = makeClient(f.base, 'tok', f.fetch, { sleep: () => {} });
  f.fail.push({ method: 'POST', match: /\/queues$/, status: 429, times: 99 });
  await assert.rejects(deploy(c, { run: 'r', orgId: ORG, ops: wsQueue }), /failed: 429/);
  assert.equal(f.calls.filter((x) => x.url.endsWith('/queues')).length, 6);
});

test('login: username + password -> a token (POST /auth/login); a wrong password is a clear error', async () => {
  const { login } = await import('../src/cib/engine.js');
  const f = fakeRossum();
  assert.equal(await login(f.base, 'u', 'p', f.fetch), 'tok');
  await assert.rejects(login(f.base, 'u', 'bad', f.fetch), /login failed: 401/);
});

test('onProgress: one call per object and per patch, with done/total', async () => {
  const { f, c } = setup(),
    p: any[] = [];
  await deploy(c, { run: 'r', orgId: ORG, ops: wsQueue, onProgress: (x) => p.push(x) });
  assert.deepEqual(
    p.filter((x) => x.phase === 'objects').map((x) => `${x.done}/${x.total}`),
    wsQueue.map((_, i) => `${i + 1}/${wsQueue.length}`),
  );
});

test('the client sends the token only to the organization origin', async () => {
  const { f, c } = setup();
  const n = f.calls.length;
  for (const url of [
    'https://evil.example/api/v1/hooks/1',
    'https://fake.rossum.app.evil.example/x',
  ])
    await assert.rejects(c.call('PATCH', url, { secrets: { s: 'x' } }), /not the organization/);
  assert.equal(f.calls.length, n); // nothing was sent
  assert.equal((await c.call('GET', `${f.api}/organizations/${ORG}`)).status !== 0, true);
});

test('a resumed deploy refuses a checkpoint that points at another origin', async () => {
  const { f, c } = setup();
  const ops = [{ key: 'h', type: 'hooks', body: { name: 'H' }, match: { name: 'H' } }];
  const patches = [{ key: 'h', body: { active: true } }];
  await c.ds('insert_one', {
    document: {
      kind: 'plan',
      run: 'r',
      ops,
      patches,
      cursor: 1,
      idmap: { h: { id: 1, url: 'https://evil.example/api/v1/hooks/1', type: 'hooks' } },
    },
  });
  await assert.rejects(deploy(c, { run: 'r', orgId: ORG, ops, patches }), /not the organization/);
  assert.ok(!f.calls.some((x) => x.url.startsWith('https://evil.example')));
});
