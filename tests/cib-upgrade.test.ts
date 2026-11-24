import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  merge3,
  upgradeCib,
  findInstall,
  guessInstalled,
  installFromOrg,
  installFromRelease,
  coupaFromInstall,
  upgradeVerdict,
} from '../src/cib/upgrade.js';
import { deployCib, configurePlan } from '../src/cib/cib.js';
import { makeClient } from '../src/cib/engine.js';
import { fakeRossum } from './support/fakeRossum.js';
import { realRelease } from './support/cibRelease.js';

const OLD = await realRelease('v2.0.0');
const NEW = await realRelease('v2.0.1');
const COUPA = { baseUrl: 'acme-test.coupahost.com', clientId: 'CID', clientSecret: 'S3CRET' };

// --- merge3 ---------------------------------------------------------------------------------------

test('merge3: a release change is taken where the org still has the base value', () => {
  const r = merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 1, x: 'server' });
  assert.deepEqual(r, { patch: { a: 2 }, conflicts: [], removed: [] });
});

test('merge3: a field both changed is a conflict and keeps the org value', () => {
  const r = merge3({ a: 1 }, { a: 2 }, { a: 3 });
  assert.deepEqual(r.patch, {});
  assert.match(r.conflicts[0], /^a: release 1 -> 2, the organization has 3/);
});

test('merge3: nested objects merge key by key, the org additions stay', () => {
  const r = merge3(
    { settings: { url: 'u1', t: 5 } },
    { settings: { url: 'u2', t: 5 } },
    { settings: { url: 'u1', t: 9, own: true } },
  );
  assert.deepEqual(r.patch, { settings: { url: 'u2', t: 9, own: true } });
});

test('merge3: a key new in the release is taken when the org lacks it, else a conflict', () => {
  assert.deepEqual(merge3({}, { k: 1 }, {}).patch, { k: 1 });
  const r = merge3({}, { k: 1 }, { k: 2 });
  assert.deepEqual(r.patch, {});
  assert.match(r.conflicts[0], /^k: new in the release/);
});

test('merge3: the org already holding the new value, or a key the release drops, is no change', () => {
  assert.deepEqual(merge3({ a: 1 }, { a: 2 }, { a: 2 }).patch, {});
  assert.deepEqual(merge3({ a: 1 }, {}, { a: 1 }).patch, {});
});

test('merge3: schema datapoints merge on id; the customer ones stay, new ones go after their predecessor', () => {
  const sec = (children: any[]) => [{ id: 's', category: 'section', children }];
  const dp = (id: string, extra: any = {}) => ({ id, category: 'datapoint', ...extra });
  const r = merge3(
    { content: sec([dp('a'), dp('b', { label: 'B' }), dp('gone')]) },
    { content: sec([dp('a'), dp('new'), dp('b', { label: 'B2' })]) },
    { content: sec([dp('a'), dp('mine'), dp('b', { label: 'B' }), dp('gone')]) },
  );
  assert.deepEqual(
    (r.patch.content as any)[0].children.map((x: any) => [x.id, x.label]),
    [
      ['a', undefined],
      ['new', undefined],
      ['mine', undefined],
      ['b', 'B2'],
      ['gone', undefined],
    ],
  );
  assert.deepEqual(r.removed, ['content[id=s].children[id=gone]']);
  assert.deepEqual(r.conflicts, []);
});

test('merge3: a datapoint both changed is a conflict on its path', () => {
  const c = (f: string) => [{ id: 's', children: [{ id: 'd', formula: f }] }];
  const r = merge3({ content: c('1') }, { content: c('2') }, { content: c('3') });
  assert.deepEqual(r.patch, {});
  assert.match(r.conflicts[0], /^content\[id=s\]\.children\[id=d\]\.formula:/);
});

test('merge3: url lists merge as sets, so a hook the customer added to a queue stays', () => {
  const r = merge3(
    { hooks: ['h1', 'h2'] },
    { hooks: ['h1', 'h3'] },
    { hooks: ['h1', 'h2', 'mine'] },
  );
  assert.deepEqual(r.patch, { hooks: ['h1', 'mine', 'h3'] });
});

test('merge3: entries labelled by "//" merge entry by entry, so an entry the customer added stays', () => {
  const e = (l: string, sel: string) => ({ '//': l, trigger: sel });
  const r = merge3(
    { configurations: [e('PL', 'a'), e('FR', 'b'), e('DE', 'c')] },
    { configurations: [e('PL', 'a2'), e('FR', 'b2'), e('DE', 'c'), e('IT', 'd')] },
    { configurations: [e('PL', 'a'), e('FR', 'mine'), e('DE', 'c'), e('BC', 'own')] },
  );
  assert.deepEqual(r.patch, {
    configurations: [e('PL', 'a2'), e('FR', 'mine'), e('DE', 'c'), e('IT', 'd'), e('BC', 'own')],
  });
  assert.deepEqual(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /^configurations\[\/\/=FR\]\.trigger:/);
});

test('merge3: a list whose labels repeat stays one value', () => {
  const e = (l: string, v: number) => ({ '//': l, v });
  const r = merge3(
    { x: [e('a', 1), e('a', 2)] },
    { x: [e('a', 1), e('a', 3)] },
    { x: [e('a', 9)] },
  );
  assert.deepEqual(r.patch, {});
  assert.match(r.conflicts[0], /^x: release/);
});

test('merge3: secrets are never compared or sent', () => {
  assert.deepEqual(merge3({ secrets: 1 }, { secrets: 2 }, {}).patch, {});
});

// --- against the fake API, with the real releases ---------------------------------------------------

const setup = async () => {
  const f = fakeRossum();
  f.onInvoke = (h) => f.collections.add(h.settings.import_config.dataset_name);
  const c = makeClient(f.base, 'tok', f.fetch);
  const r = await deployCib(c, {
    plan: structuredClone(OLD.plan),
    orgId: 1,
    run: 'install',
    coupa: COUPA,
    region: 'prod-eu',
    hooksCsv: OLD.hooksCsv,
    requiredScopes: [],
    waitOpts: { sleep: () => {} },
  });
  assert.equal(r.status, 'done');
  return { f, c };
};
const opts = (install: any, extra: any = {}) => ({
  install,
  plan: structuredClone(NEW.plan),
  hooksCsv: NEW.hooksCsv,
  region: 'prod-eu',
  orgId: 1,
  coupa: COUPA,
  run: 'up',
  ...extra,
});

test('a complete deploy is the install record; the Coupa values are read back from it', async () => {
  const { c } = await setup();
  const i = (await findInstall(c))!;
  assert.equal(i.release, 'v2.0.0');
  assert.equal(Object.keys(i.idmap).length, 219);
  assert.deepEqual(coupaFromInstall(i.ops), {
    baseUrl: 'https://acme-test.coupahost.com/',
    clientId: 'CID',
  });
});

test('v2.0.0 -> v2.0.1: the check writes nothing, the upgrade applies it, and a second check finds nothing to do', async () => {
  const { f, c } = await setup();
  const install = (await findInstall(c))!;
  const before = f.calls.length;
  const plan = await upgradeCib(c, opts(install));
  assert.equal(plan.status, 'planned');
  assert.ok(
    f.calls.slice(before).every((x) => x.method === 'GET' || x.url.includes('/data-storage/')),
  );
  const updates = plan.items.filter((i) => i.action === 'update');
  assert.ok(updates.length > 0);
  assert.equal(plan.items.filter((i) => i.action === 'create').length, 0);
  assert.equal(
    plan.items.reduce((s, i) => s + i.conflicts.length, 0),
    0,
  );

  const done = await upgradeCib(c, opts(install, { apply: true }));
  assert.equal(done.status, 'done');
  assert.equal(done.items.filter((i) => i.action === 'update').length, updates.length);
  const rec = (await findInstall(c))!;
  assert.equal(rec.release, 'v2.0.1');

  // the same release, configured as the upgrade did, now matches the org field for field
  const again = await upgradeCib(c, { ...opts({ ...rec, recorded: false }), run: 'up2' });
  assert.equal(again.items.filter((i) => i.action === 'update').length, 0);
  assert.equal((await upgradeCib(c, opts(rec))).status, 'current');
});

test('a customer edit to a field the release changes is a conflict and survives the upgrade', async () => {
  const { f, c } = await setup();
  const install = (await findInstall(c))!;
  const plan = await upgradeCib(c, opts(install));
  const it = plan.items.find((i) => i.action === 'update' && i.type === 'hooks')!;
  const obj = f.db.hooks.find((h) => h.url === it.url)!;
  const field = it.fields[0];
  obj[field] = 'customer value';
  const done = await upgradeCib(c, opts(install, { apply: true }));
  const after = done.items.find((i) => i.key === it.key)!;
  assert.ok(after.conflicts.some((x) => x.startsWith(field)));
  assert.equal(obj[field], 'customer value');
  const rec = f.ds.find((d) => d.doc.run === 'up')!.doc;
  assert.ok(rec.conflicts.some((x: string) => x.startsWith(`${it.key} ${field}`)));
});

test('an object new in the release is created; one gone from it is only reported', async () => {
  const { f, c } = await setup();
  const install = (await findInstall(c))!;
  const plan = structuredClone(NEW.plan);
  const hookOp = plan.ops.find((o: any) => o.type === 'hooks' && !o.template);
  const added = {
    ...structuredClone(hookOp),
    key: 'hooks:999',
    match: { name: 'New hook (CIB)' },
    body: { ...structuredClone(hookOp.body), name: 'New hook (CIB)', run_after: [] },
  };
  plan.ops.push(added);
  const gone = plan.ops.findIndex((o: any) => o.type === 'rules');
  const goneName = plan.ops[gone].body.name;
  plan.ops.splice(gone, 1);
  const n = f.db.hooks.length;
  const r = await upgradeCib(c, opts(install, { plan, apply: true }));
  assert.equal(r.status, 'done');
  assert.deepEqual(
    r.items.filter((i) => i.action === 'create').map((i) => i.name),
    ['New hook (CIB)'],
  );
  assert.equal(f.db.hooks.length, n + 1);
  assert.deepEqual(
    r.items.filter((i) => i.action === 'removed').map((i) => i.name),
    [goneName],
  );
  assert.ok(f.db.rules.some((x) => x.name === goneName));
});

test('no install record: the named release is found in the org by name and used as the base', async () => {
  const { f, c } = await setup();
  f.ds.length = 0; // as if deployed before records were kept
  assert.equal(await findInstall(c), null);
  const p = configurePlan(OLD.plan, { coupa: COUPA, region: 'prod-eu', hooksCsv: OLD.hooksCsv });
  const install = await installFromRelease(c, 'v2.0.0', p.ops, 1);
  assert.equal(Object.keys(install.idmap).length, 219);
  const r = await upgradeCib(c, opts(install));
  assert.equal(r.items.filter((i) => i.action === 'create').length, 0);
  assert.ok(r.notes.some((n) => /no install record/.test(n)));
});

test('no install record: the Coupa URL and client ID are read from the org when step 2 is empty', async () => {
  const { c } = await setup();
  const where = { region: 'prod-eu', orgId: 1 };
  const r = await installFromOrg(
    c,
    { tag: 'v2.0.0', ...OLD },
    { ...where, coupa: { baseUrl: '', clientId: '' } },
  );
  assert.deepEqual(
    [r.coupa, r.fromOrg, Object.keys(r.install.idmap).length],
    [{ baseUrl: 'https://acme-test.coupahost.com/', clientId: 'CID' }, true, 219],
  );
  assert.equal(coupaFromInstall(r.install.ops)!.clientId, 'CID');
  // step 2 values win, and then the schemas are not read
  const k = { baseUrl: 'https://other.coupahost.com/', clientId: 'X' };
  const s = await installFromOrg(c, { tag: 'v2.0.0', ...OLD }, { ...where, coupa: k });
  assert.deepEqual([s.coupa, s.fromOrg], [k, false]);
});

test('no install record: the release the org was deployed from is the closest one', async () => {
  const { f, c } = await setup();
  const before = f.calls.length;
  const g = await guessInstalled(
    c,
    [
      { tag: 'v2.0.1', ...NEW },
      { tag: 'v2.0.0', ...OLD },
    ],
    { region: 'prod-eu', orgId: 1, coupa: { baseUrl: '', clientId: '' } },
  );
  assert.equal(g[0].tag, 'v2.0.0');
  assert.ok(g[0].lacks < g[1].lacks, JSON.stringify(g));
  assert.ok(f.calls.slice(before).every((x) => x.method === 'GET'));
});

test('upgradeVerdict says how it ended', () => {
  const base = { from: 'v1', to: 'v2', blockers: [], notes: [] };
  assert.equal(upgradeVerdict({ ...base, status: 'current', items: [] }).tone, 'ok');
  assert.equal(upgradeVerdict({ ...base, status: 'blocked', items: [] }).tone, 'fail');
  const item = {
    key: 'k',
    type: 'hooks',
    name: 'n',
    action: 'update' as const,
    fields: ['a'],
    conflicts: ['x'],
    removed: [],
  };
  const v = upgradeVerdict({ ...base, status: 'planned', items: [item] });
  assert.equal(v.tone, 'warn');
  assert.match(v.text, /1 to update, 0 to create, 0 unchanged, 1 conflicts/);
});

test('an upgrade that stops part-way resumes with the same run ID', async () => {
  const { f, c } = await setup();
  const install = (await findInstall(c))!;
  const plan = await upgradeCib(c, opts(install));
  const it = plan.items.find((i) => i.action === 'update')!;
  f.fail.push({ method: 'PATCH', match: new RegExp(`${it.url}$`), status: 500, times: 1 });
  await assert.rejects(upgradeCib(c, opts(install, { apply: true })), /update .* failed: 500/);
  assert.equal((await findInstall(c))!.release, 'v2.0.0');
  const r = await upgradeCib(c, opts(install, { apply: true }));
  assert.equal(r.status, 'done');
  assert.equal((await findInstall(c))!.release, 'v2.0.1');
});

// a release that adds one Coupa import hook needing the secret (the same shape as the real ones)
const withNewSecretHook = () => {
  const plan = structuredClone(NEW.plan);
  const rows: string[] = NEW.hooksCsv.trim().split(/\r?\n/);
  const head = rows[0].split(',');
  const col = (r: string, k: string) => r.split(',')[head.indexOf(k)];
  const row = rows.find((r) => col(r, 'patch_secret') === 'true' && col(r, 'invoke') === 'true')!;
  const name = col(row, 'hook_name');
  const op = plan.ops.find((o: any) => o.type === 'hooks' && o.body.name === name);
  const added = structuredClone(op);
  added.key = 'hooks:new-import';
  added.match = { name: 'New import (CIB)' };
  added.body.name = 'New import (CIB)';
  plan.ops.push(added);
  const hooksCsv = `${NEW.hooksCsv.trim()}\n${row.replace(name, 'New import (CIB)')}`;
  return { plan, hooksCsv, active: op.body.active };
};

test('upgrade without the secret: a new secret hook is created active without it, not invoked, and listed', async () => {
  const { f, c } = await setup();
  const install = (await findInstall(c))!;
  const { plan, hooksCsv, active } = withNewSecretHook();
  const noSecret = { baseUrl: COUPA.baseUrl, clientId: COUPA.clientId, clientSecret: '' };
  const check = await upgradeCib(c, opts(install, { plan, hooksCsv, coupa: noSecret }));
  assert.equal(check.status, 'planned');
  assert.ok(check.notes.some((n) => /creates 1 hooks that need the Coupa client secret/.test(n)));
  const invokes = f.calls.filter((x) => x.url.endsWith('/invoke')).length;
  const r = await upgradeCib(c, opts(install, { plan, hooksCsv, coupa: noSecret, apply: true }));
  assert.equal(r.status, 'done');
  const h = f.db.hooks.find((x) => x.name === 'New import (CIB)')!;
  assert.equal(h.active, active);
  assert.ok(!h.secrets);
  assert.equal(f.calls.filter((x) => x.url.endsWith('/invoke')).length, invokes);
  assert.deepEqual(r.needSecret, [{ name: 'New import (CIB)', url: h.url }]);
  const rec = f.ds.find((d) => d.doc.run === 'up')!.doc;
  assert.equal(rec.complete, true);
  assert.equal(rec.secretGiven, false);
  const v = upgradeVerdict(r);
  assert.equal(v.tone, 'warn');
  assert.match(v.text, /1 new hooks wait for the organization's admin to add client_secret/);
});

test('upgrade with the secret: the new secret hook gets it and its first import', async () => {
  const { f, c } = await setup();
  const install = (await findInstall(c))!;
  const { plan, hooksCsv } = withNewSecretHook();
  const r = await upgradeCib(c, opts(install, { plan, hooksCsv, apply: true }));
  assert.equal(r.status, 'done');
  assert.equal(r.needSecret, undefined);
  const h = f.db.hooks.find((x) => x.name === 'New import (CIB)')!;
  assert.equal(h.secrets?.client_secret, 'S3CRET');
  assert.deepEqual(
    r.invoked!.map((x) => x.key),
    ['hooks:new-import'],
  );
  assert.equal(f.ds.find((d) => d.doc.run === 'up')!.doc.secretGiven, undefined);
});
