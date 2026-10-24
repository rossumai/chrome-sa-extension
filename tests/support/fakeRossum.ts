// In-memory fake of the Rossum API parts the CIB engine (src/cib/) uses. Test utility only.
// Everything it stores is raw API JSON, hence the `any`s.
// Behaviour copied from real responses (EXPERIMENTS.md E12/E16, checks on 2026-10-19):
// - list filters take numbers for FK params (engine=<url> -> 400 "Enter a number.")
// - POST /hooks/create needs hook_template, returns 201 with config.private = true
// - GET /auth/user returns the user url, organization and role urls (groups); /groups lists the roles
// - organization.organization_group -> features.maximum_hook_timeout {enabled, seconds},
//   deployment_location, a region name such as 'prod-eu2' (live on a test org, 2026-10-24)
// - GET /hook_templates/<id> -> 404 when the org cannot see the template
// - data storage collections/create, indexes/create, collections/list {result: [names]} (tool v1.3.3);
//   delete_one {filter} -> {result: {deleted_count}} (live on a test org, 2026-10-22)
// - POST /hooks/<id>/invoke starts the hook; f.onInvoke(hook) simulates what the import writes and
//   returns the response body (a function hook answers with its return value)
// - queue.webhooks takes /webhooks/<id> urls only; a /hooks/<id> url -> 400 (test org, 2026-10-19)
// - lists page through pagination.next (a cursor url on the real API)
// - GET /svc/master-data-hub/api/v1/operation/?dataset_name= -> {operations}, newest first; an invoke of an import
//   hook adds a finished operation. `query` on it is fake-only: the query the job ran with.
const TEMPLATES: Record<string, any> = {
  55: { type: 'job', config: { private: true, schedule: { cron: '0 3 * * *' } } },
  39: { type: 'webhook', config: { private: true, schedule: {} } },
  28: { type: 'webhook', config: { private: true, schedule: {} } },
};

export type FakeRossum = ReturnType<typeof fakeRossum>;

export function fakeRossum(base = 'https://fake.rossum.app') {
  // ponytail: one loose record type for every collection; the fake only mirrors wire JSON
  const api = `${base}/api/v1`;
  const db: Record<string, any[]> = {
      organizations: [
        {
          id: 1,
          url: `${api}/organizations/1`,
          organization_group: `${api}/organization_groups/9`,
        },
      ],
      organization_groups: [
        {
          id: 9,
          url: `${api}/organization_groups/9`,
          name: 'G',
          deployment_location: 'prod-eu',
          features: {
            maximum_hook_timeout: { enabled: true, seconds: 360 },
            einvoicing: { enabled: true },
          },
        },
      ],
      groups: [
        'viewer',
        'annotator',
        'admin',
        'manager',
        'annotator_limited',
        'organization_group_admin',
      ].map((name, i) => ({ id: i + 1, url: `${api}/groups/${i + 1}`, name })),
      hook_templates: [55, 39, 28].map((id) => ({ id, url: `${api}/hook_templates/${id}` })),
    },
    mdh: Record<string, any[]> = {},
    ds: any[] = [],
    calls: any[] = [],
    collections = new Set<string>(),
    indexes: any[] = [];
  const user = {
    id: 1,
    url: `${api}/users/1`,
    organization: `${api}/organizations/1`,
    groups: [`${api}/groups/3`],
  };
  let nextId = 1000;
  const fail: any[] = []; // [{method, match: RegExp, status, times}]
  const json = (status: number, data?: unknown) =>
    new Response(data === undefined ? null : JSON.stringify(data), { status });
  const create = (type: string, body: any) => {
    const id = nextId++;
    const obj = { ...structuredClone(body), id, url: `${api}/${type}/${id}` };
    (db[type] ??= []).push(obj);
    return obj;
  };
  const fetch = async (url: string, { method = 'GET', body }: any = {}) => {
    const data = body ? JSON.parse(body) : undefined;
    calls.push({ method, url, body: data });
    const f = fail.find((x) => x.method === method && x.match.test(url) && x.times !== 0);
    if (f) {
      f.times--;
      return json(f.status, { detail: 'injected failure' });
    }
    const u = new URL(url);
    if (u.pathname === '/svc/master-data-hub/api/v1/operation/')
      return json(200, {
        operations: [...(mdh[u.searchParams.get('dataset_name')!] ?? [])].reverse(),
      });
    if (u.pathname.startsWith('/svc/data-storage/api/v1/')) {
      const op = u.pathname.split('/').pop();
      const hit = (q: any) =>
        ds.filter(
          (d) =>
            d.collectionName === data.collectionName &&
            Object.entries(q).every(([k, v]) => d.doc[k] === v),
        );
      if (u.pathname.endsWith('/collections/create')) {
        if (collections.has(data.collectionName)) return json(409);
        collections.add(data.collectionName);
        return json(200, { result: {} });
      }
      if (u.pathname.endsWith('/indexes/create')) {
        indexes.push(data);
        return json(200, { result: {} });
      }
      if (u.pathname.endsWith('/collections/list'))
        return json(200, {
          result: [...new Set([...collections, ...ds.map((d) => d.collectionName)])],
        });
      if (op === 'find')
        return json(200, { result: hit(data.query).map((d) => structuredClone(d.doc)) });
      if (op === 'insert_one') {
        ds.push({ collectionName: data.collectionName, doc: structuredClone(data.document) });
        return json(200, { result: {} });
      }
      if (op === 'delete_one') {
        const [d] = hit(data.filter);
        if (d) ds.splice(ds.indexOf(d), 1);
        return json(200, { result: { deleted_count: d ? 1 : 0 } });
      }
      if (op === 'update_one') {
        const [d] = hit(data.filter);
        if (d) Object.assign(d.doc, structuredClone(data.update.$set));
        return json(200, { result: {} });
      }
      return json(404);
    }
    const path = u.pathname.replace('/api/v1/', '');
    if (method === 'GET' && path === 'auth/user') return json(200, user);
    if (method === 'POST' && path === 'auth/login')
      return data.username === 'u' && data.password === 'p'
        ? json(200, { key: 'tok', domain: u.host })
        : json(401, { non_field_errors: ['Unable to log in with provided credentials.'] });
    if (method === 'POST' && path === 'hooks/create') {
      const t = TEMPLATES[data.hook_template?.split('/').pop()];
      if (!t) return json(400, { hook_template: ['Invalid'] });
      const { hook_template, ...rest } = data;
      return json(
        201,
        create('hooks', {
          ...rest,
          type: t.type,
          config: structuredClone(t.config),
          hook_template,
        }),
      );
    }
    const [type, id, action] = path.split('/');
    if (method === 'POST' && type === 'hooks' && action === 'invoke') {
      const h = db.hooks?.find((o) => String(o.id) === id);
      if (!h) return json(404, { detail: 'Not found.' });
      const ic = h.settings?.import_config;
      if (ic?.dataset_name)
        (mdh[ic.dataset_name] ??= []).push({
          operation_id: `op${nextId++}`,
          status: 'finished',
          create_ts: new Date().toISOString(),
          query: structuredClone(ic.query),
        });
      return json(200, fakeApi.onInvoke?.(h) ?? {});
    }
    if (
      method === 'POST' &&
      type === 'queues' &&
      (data.webhooks ?? []).some((u: string) => !u.includes('/webhooks/'))
    )
      return json(400, { webhooks: ['Invalid hyperlink - Incorrect URL match.'] });
    if (method === 'POST' && !id) return json(201, create(type, data));
    if (method === 'GET' && !id) {
      const q = [...u.searchParams].filter(([k]) => k !== 'page_size' && k !== 'page');
      for (const [k, v] of q)
        if (k === 'engine' && !/^\d+$/.test(v)) return json(400, { engine: ['Enter a number.'] });
      const eq = (have: any, want: string) =>
        (typeof have === 'string' && have.startsWith(api)
          ? have.split('/').pop()
          : String(have)) === want;
      const all = (db[type] ?? []).filter((o) => q.every(([k, v]) => eq(o[k], v)));
      const size = +(u.searchParams.get('page_size') ?? 20),
        page = +(u.searchParams.get('page') ?? 1);
      const next =
        page * size < all.length
          ? (u.searchParams.set('page', String(page + 1)), u.toString())
          : null;
      return json(200, {
        pagination: { total: all.length, next },
        results: all.slice((page - 1) * size, page * size),
      });
    }
    const obj = (db[type] ?? []).find((o) => String(o.id) === id);
    if (!obj) return json(404, { detail: 'Not found.' });
    if (method === 'GET') return json(200, obj);
    if (method === 'PATCH') {
      Object.assign(obj, structuredClone(data));
      return json(200, obj);
    }
    if (method === 'DELETE') {
      db[type].splice(db[type].indexOf(obj), 1);
      return json(204);
    }
    return json(405);
  };
  const fakeApi = {
    base,
    api,
    fetch: fetch as unknown as typeof globalThis.fetch,
    db,
    ds,
    calls,
    fail,
    user,
    collections,
    indexes,
    mdh,
    onInvoke: null as ((hook: any) => unknown) | null, // its return value is the invoke response
  };
  return fakeApi;
}
