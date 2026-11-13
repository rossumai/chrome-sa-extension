import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { diffEnvTree, envInputFor, isFirstRead, runErrorFor } from '../src/rdc/core.js';
import { dataStorageFor } from '../src/rdc/sourceStore.js';
import {
  STATE_COLLECTION,
  keepStateInOrgs,
  sourceEnvInput,
  TARGET_ENV,
} from '../src/rdc/deploy.js';
import { overwrittenEdits, writeList } from '../src/rdc/plan.js';
import { writeTokenOwner } from '../src/rdc/runPlan.js';
import { OVERLAY_PATH, readHookTokenOwner } from '../src/rdc/tokenOwner.js';

// Loads the real rdc wasm in Node from the optional @mrtnzlml/rdc-wasm package, or from
// RDC_WASM_DIR (a local build, as for build.js). Skipped when there is none (no GitHub Packages
// token, CI included). No network: an env's apiBase is a closed local port.
const VENDOR = process.env.RDC_WASM_DIR
  ? join(process.cwd(), process.env.RDC_WASM_DIR)
  : join(process.cwd(), 'node_modules', '@mrtnzlml', 'rdc-wasm');
const present = existsSync(join(VENDOR, 'rdc_wasm.js'));
// Builds with the crash-safe sync whose state the page stores (`useStateStore`), and the Web Lock.
const dts = present ? readFileSync(join(VENDOR, 'rdc_wasm.d.ts'), 'utf8') : '';
const crashSafe = dts.includes('useStateStore');
// The page's store over a fake org's Data Storage (see `fakeOrg`).
const stateIn = (domain: string) => {
  const ds = dataStorageFor(domain, 'tok', STATE_COLLECTION);
  return { source: ds, target: ds };
};
const hasMigrate = /\bmigrate\(src: string/.test(dts);

describe.skipIf(!present)('rdc wasm package (Node)', () => {
  it('instantiates and creates an in-memory project for the connected env', async () => {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    expect(glue.version()).toMatch(/^\d+\.\d+\.\d+/);
    const env = envInputFor(
      'https://acme.rossum.app',
      'tok',
      { results: [{ id: 42, name: 'Acme' }] },
      TARGET_ENV,
    );
    if (typeof env === 'string') throw new Error(env);
    const project = glue.Project.create('console', env);
    const files: Map<string, Uint8Array> = project.files();
    expect(files.has('rdc.toml')).toBe(true);
    const toml = new TextDecoder().decode(files.get('rdc.toml'));
    expect(toml).toContain(`[envs.${TARGET_ENV}]`);
    expect(toml).toContain('https://acme.rossum.app/api/v1');
    expect(toml).toContain('42');
    expect(typeof project.sync).toBe('function');
    project.free();
  });

  it('holds the target and the source as two envs of one in-memory project', async () => {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    const target = envInputFor(
      'https://acme.rossum.app',
      'tok',
      { results: [{ id: 31007, name: 'Acme' }] },
      TARGET_ENV,
    );
    if (typeof target === 'string') throw new Error(target);
    const project = glue.Project.create('console', target);
    const src = sourceEnvInput(
      {
        name: 'test',
        domain: 'https://partner-sandbox.rossum.app',
        orgId: 20412,
        orgName: 'Acme Test',
      },
      'tok2',
    );
    if (typeof src === 'string') throw new Error(src);
    project.addEnv(src);
    const toml = new TextDecoder().decode(project.files().get('rdc.toml'));
    expect(toml).toContain('[envs.target]');
    expect(toml).toContain('[envs.source]');
    expect(toml).toContain('20412');
    project.free();
  });
});

describe.skipIf(!crashSafe)('rdc wasm with the crash-safe sync (Node)', () => {
  const closed = {
    name: TARGET_ENV,
    apiBase: 'http://127.0.0.1:9/api/v1',
    orgId: 7,
    authKind: 'token' as const,
    token: 'tok',
  };
  async function load() {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    return glue;
  }

  it('refuses a store that is not exactly load and save', async () => {
    const project = (await load()).Project.create('console', closed);
    expect(() => project.useStateStore({ load: async () => null })).toThrow();
    project.free();
  });

  it("takes the page's store", async () => {
    const project = (await load()).Project.create('console', closed);
    expect(keepStateInOrgs(project, stateIn('http://127.0.0.1:9'), 7)).toBe(true);
    project.free();
  });

  it("refuses to sync an org whose Web Lock another tab holds, with the page's phrase", async () => {
    const project = (await load()).Project.create('console', closed);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let taken!: () => void;
    const granted = new Promise<void>((r) => (taken = r));
    void navigator.locks.request('rdc:http://127.0.0.1:9/api/v1:7', () => {
      taken();
      return held;
    });
    await granted;
    const err = await project
      .sync(
        TARGET_ENV,
        { noPush: true },
        async () => null,
        () => {},
      )
      .then(
        () => null,
        (e: Error) => e,
      );
    release();
    expect(err?.message).toContain('already being synced in another tab');
    expect(runErrorFor(err!.message)).toMatch(/Another tab of this browser/);
    project.free();
  });
});

describe.skipIf(!hasMigrate)('rdc wasm migrate (Node)', () => {
  it("gives a result the page's Review understands, and writes only when not a dry run", async () => {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    // no Data Storage state: nothing leaves the process, and no Web Lock is taken
    const env = (name: string, orgId: number) => ({
      name,
      apiBase: `http://127.0.0.${orgId}:9/api/v1`,
      orgId,
      authKind: 'token' as const,
      token: 'tok',
    });
    const project = glue.Project.create('console', env(TARGET_ENV, 1));
    project.addEnv(env('source', 2));
    const label = new TextEncoder().encode('{\n  "name": "hold"\n}\n');
    project.writeFile('envs/source/labels/hold.json', label);
    expect(() => project.migrate('source', TARGET_ENV, { bogus: 1 }, () => {})).toThrow(
      /unknown option 'bogus'/,
    );

    const lines: string[] = [];
    const plan = await project.migrate('source', TARGET_ENV, { dryRun: true }, (l: string) =>
      lines.push(l),
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(plan.creates).toBe(1);
    expect(project.files().has('envs/target/labels/hold.json')).toBe(false);
    // each file names its object as the sync plan does
    expect(plan.files).toContainEqual(
      expect.objectContaining({
        target: 'envs/target/labels/hold.json',
        kind: 'labels',
        slug: 'hold',
      }),
    );
    const sends = {
      items: [
        {
          kind: 'labels',
          slug: 'hold',
          direction: 'push',
          change: 'create',
          prompt: null,
          note: null,
        },
      ],
      recovered: [],
      problems: [],
    };
    expect(overwrittenEdits(plan, sends as any, ['envs/target/labels/hold.json'])).toEqual([
      'labels/hold',
    ]);

    await project.migrate('source', TARGET_ENV, { dryRun: false }, () => {});
    expect(project.files().has('envs/target/labels/hold.json')).toBe(true);
    project.free();
  });
});

// A fake org over `fetch`: Data Storage keeps documents in memory; the API lists one label, whose
// name the test changes to stand for an edit made directly in the target. Every other list is
// empty. Nothing leaves the process.
function fakeOrg() {
  const docs = new Map<string, any>();
  const org = { labelName: 'hold' };
  const matches = (d: any, q: any) =>
    Object.entries(q ?? {}).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && '$in' in v ? v.$in.includes(d[k]) : d[k] === v,
    );
  const fetch = async (input: any, init: any = {}) => {
    const url: string = typeof input === 'string' ? input : input.url;
    const raw = typeof input === 'string' ? (init.body ?? '') : await input.text();
    const body = raw ? JSON.parse(raw) : {};
    const reply = (o: unknown, status = 200) => {
      const r = new Response(JSON.stringify(o), {
        status,
        headers: { 'content-type': 'application/json' },
      });
      Object.defineProperty(r, 'url', { value: url });
      return r;
    };
    const u = new URL(url);
    if (u.pathname.includes('/svc/data-storage/')) {
      const ok = (result: unknown) => reply({ code: 'ok', message: '', result });
      const op = u.pathname.split('/').pop();
      if (op === 'find') return ok([...docs.values()].filter((d) => matches(d, body.query)));
      if (op === 'insert_one') {
        if (docs.has(body.document._id)) return reply({ detail: 'duplicate key' }, 400);
        docs.set(body.document._id, body.document);
        return ok({ inserted_id: body.document._id });
      }
      if (op === 'insert_many') {
        for (const d of body.documents) {
          if (docs.has(d._id)) return reply({ detail: 'duplicate key' }, 400);
          docs.set(d._id, d);
        }
        return ok({});
      }
      if (op === 'replace_one') {
        const hit = [...docs.values()].find((d) => matches(d, body.filter));
        if (hit) docs.set(hit._id, { ...body.replacement, _id: hit._id });
        else if (body.options?.upsert)
          docs.set(body.filter._id, { ...body.replacement, _id: body.filter._id });
        return ok({ matched_count: hit ? 1 : 0, modified_count: hit ? 1 : 0, upserted_id: null });
      }
      return ok(op === 'delete_many' ? { deleted_count: 0 } : []);
    }
    const path = u.pathname.replace(/^\/api\/v1\//, '').replace(/\/$/, '');
    if (path === 'labels')
      return reply({
        results: [
          {
            id: 11,
            url: `${u.origin}/api/v1/labels/11`,
            name: org.labelName,
            organization: `${u.origin}/api/v1/organizations/7`,
            color: null,
          },
        ],
        pagination: { next: null, total: 1 },
      });
    if (path.startsWith('organizations/')) return reply({ id: 7, url, name: 'Acme' });
    return reply({ results: [], pagination: { next: null, total: 0 } });
  };
  return { fetch, docs, org };
}

describe.skipIf(!hasMigrate)("rdc wasm migrate and the hooks' token owner (Node)", () => {
  it('writes the overlay owner the page set into every hook it copies', async () => {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    const env = (name: string, orgId: number) => ({
      name,
      apiBase: `http://127.0.0.${orgId}:9/api/v1`,
      orgId,
      authKind: 'token' as const,
      token: 'tok',
    });
    const project = glue.Project.create('console', env(TARGET_ENV, 1));
    project.addEnv(env('source', 2));
    const hook = {
      name: 'MDH',
      type: 'function',
      extension_source: 'rossum_store',
      token_owner: 'http://127.0.0.2:9/api/v1/users/1',
      events: [],
      queues: [],
    };
    project.writeFile(
      'envs/source/hooks/mdh.json',
      new TextEncoder().encode(JSON.stringify(hook, null, 2) + '\n'),
    );
    const owner = 'http://127.0.0.1:9/api/v1/users/42';
    writeTokenOwner(project, owner);
    const result = await project.migrate('source', TARGET_ENV, { dryRun: false }, () => {});
    expect(result.files).toContainEqual(
      expect.objectContaining({ target: 'envs/target/hooks/mdh.json', kind: 'hooks', slug: 'mdh' }),
    );
    const migrated = JSON.parse(
      new TextDecoder().decode(project.files().get('envs/target/hooks/mdh.json')),
    );
    expect(migrated.token_owner).toBe(owner);
    expect(readHookTokenOwner(new TextDecoder().decode(project.files().get(OVERLAY_PATH)))).toBe(
      owner,
    );
    project.free();
  });
});

describe.skipIf(!crashSafe)('rdc wasm: the read finds direct edits (Node, fake org)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a dry run brings back the last run's tree, and the pull changes only the edited object", async () => {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    const fake = fakeOrg();
    vi.stubGlobal('fetch', fake.fetch);
    const env = {
      name: TARGET_ENV,
      apiBase: 'http://acme.test/api/v1',
      orgId: 7,
      authKind: 'token' as const,
      token: 'tok',
    };
    const quiet = async () => null;
    // As the page reads the target: a dry run, a snapshot, the pull, a snapshot.
    const read = async () => {
      const project = glue.Project.create('console', env);
      expect(keepStateInOrgs(project, stateIn('http://acme.test'), 7)).toBe(true);
      await project.sync(TARGET_ENV, { dryRun: true }, quiet, () => {});
      const before: Map<string, Uint8Array> = project.files();
      await project.sync(TARGET_ENV, { noPush: true }, quiet, () => {});
      const after: Map<string, Uint8Array> = project.files();
      project.free();
      return { before, after };
    };

    const first = await read();
    expect(isFirstRead(first.before, TARGET_ENV)).toBe(true);
    expect(first.after.has('envs/target/labels/hold.json')).toBe(true);
    // each org's state, in the extension's collection, under the page's key
    // one document per env, written by the page's store: a rev and an opaque snapshot
    expect([...fake.docs.keys()]).toEqual(['chrome-sa-extension/rdc-deployments/7/target']);
    const doc = fake.docs.get('chrome-sa-extension/rdc-deployments/7/target');
    expect(Object.keys(doc).sort()).toEqual(['_id', 'rev', 'snapshot']);
    expect(typeof doc.snapshot).toBe('string');

    // nothing changed: a second visit lists nothing
    const same = await read();
    expect(isFirstRead(same.before, TARGET_ENV)).toBe(false);
    expect(diffEnvTree(same.before, same.after, TARGET_ENV)).toEqual([]);

    // an edit made directly in the target
    fake.org.labelName = 'hold-edited';
    const edited = await read();
    expect(diffEnvTree(edited.before, edited.after, TARGET_ENV)).toEqual([
      { path: 'envs/target/labels/hold.json', change: 'changed' },
    ]);

    // A change saved to the tree but never pushed (a write whose sync did not finish): a dry run
    // of the target lists it, which is what Review shows as "already waiting".
    const project = glue.Project.create('console', env);
    keepStateInOrgs(project, stateIn('http://acme.test'), 7);
    await project.sync(TARGET_ENV, { noPush: true }, quiet, () => {});
    const label = new TextDecoder()
      .decode(project.files().get('envs/target/labels/hold.json'))
      .replace('hold-edited', 'hold-from-source');
    project.writeFile('envs/target/labels/hold.json', new TextEncoder().encode(label));
    // Plan's scratch copy: no Data Storage state, so nothing is saved; its dry run answers the plan
    const scratch = new glue.Project(project.files());
    project.free();
    const out = await scratch.sync(
      TARGET_ENV,
      { dryRun: true, interactive: false },
      quiet,
      () => {},
    );
    scratch.free();
    expect(out.skipped).toEqual([]);
    expect(out.plan.items).toContainEqual(
      expect.objectContaining({
        kind: 'labels',
        slug: 'hold',
        direction: 'push',
        change: 'update',
      }),
    );
    expect(writeList(out.plan).update.map((x: any) => `${x.kind}/${x.slug}`)).toEqual([
      'labels/hold',
    ]);
  });
});
