// src/training/load.ts
// Reads what a set of checks needs, and nothing else, through an injected `get`
// — the content script passes its same-origin fetcher, the Console its own. Every
// request is a READ: GETs on /api/v1/, and two Data Storage list queries
// (`collections/list`, `data/aggregate` with `$count`) that are POSTs only
// because that service takes queries as bodies. `Training never mutates`.
//
// Objects are found by their EXACT name (`?name=` is an exact, case-sensitive
// match on queues and rules, measured 2026-11-13), so other people working in the
// same org cannot affect a trainee's checks.
import { allTasks, namesFor, type Need, type Task, type Track } from './track.js';
import { evaluateTask, buildOf, type Assertion, type Build, type Ctx } from './checks.js';
import { reachedMissions, type Progress } from './progress.js';

export type GetOptions = { method?: string; body?: unknown; auth?: 'token' | 'bearer' };
export type Get = (path: string, opts?: GetOptions) => Promise<any>;

const DS = '/svc/data-storage/api/v1';

/** `https://host/api/v1/x?y` → `/api/v1/x?y`. Both fetchers take paths, never absolute URLs. */
export function pathOf(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

const idOf = (url: unknown): number | null => {
  const m = /\/(\d+)\/?$/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
};

/** Every datapoint at any depth: a table nests multivalue → tuple → children. */
function fieldsOf(content: unknown): Array<{ id: string; type: string | null; rir: string[] }> {
  const out: Array<{ id: string; type: string | null; rir: string[] }> = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.category === 'datapoint' && typeof node.id === 'string') {
      out.push({
        id: node.id,
        type: typeof node.type === 'string' ? node.type : null,
        rir: Array.isArray(node.rir_field_names) ? node.rir_field_names : [],
      });
    }
    if (node.children) walk(node.children);
  };
  walk(content);
  return out;
}

/** True when an annotation's content holds `vendor_match` with a value. */
export function hasVendorMatch(content: unknown): boolean {
  let found = false;
  const walk = (node: any): void => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.schema_id === 'vendor_match' && String(node.content?.value ?? '').trim()) {
      found = true;
      return;
    }
    if (node.children) walk(node.children);
    if (node.content && Array.isArray(node.content)) walk(node.content);
  };
  walk((content as any)?.content ?? (content as any)?.results ?? content);
  return found;
}

/** The union of what the tasks read. */
export function needsOf(tasks: Task[]): Set<Need> {
  return new Set<Need>(tasks.flatMap((t) => t.needs));
}

export async function loadContext(asked: Set<Need>, run: string, get: Get): Promise<Ctx> {
  const names = namesFor(run);
  const needs = new Set(asked);
  // The schema, hooks and invoices are all found through the queue.
  if (needs.has('schema') || needs.has('hooks') || needs.has('annotations')) needs.add('queue');
  const ctx: Ctx = { names };

  if (needs.has('queue')) {
    const res = await get(`/api/v1/queues?name=${encodeURIComponent(names.queue)}`);
    // A deleted queue is not gone at once: Rossum keeps it for 24 h as
    // `deletion_requested` (the default DELETE), still answering `?name=`. Such a queue
    // is gone as far as the trainee is concerned (owner report, 2026-11-16).
    const q = (res?.results || []).find(
      (x: any) => x?.name === names.queue && !String(x?.status || '').startsWith('deletion'),
    );
    ctx.queue = q ? { id: Number(q.id ?? idOf(q.url)), schemaPath: pathOf(q.schema) } : null;
  }
  const queue = ctx.queue;

  if (needs.has('schema')) {
    if (!queue?.schemaPath) ctx.schema = null;
    else {
      const s = await get(queue.schemaPath);
      ctx.schema = { id: Number(s?.id ?? idOf(s?.url)), fields: fieldsOf(s?.content) };
    }
  }

  if (needs.has('hooks')) {
    if (!queue) ctx.hooks = [];
    else {
      const res = await get(`/api/v1/hooks?queue=${queue.id}&page_size=100`);
      ctx.hooks = (res?.results || [])
        .filter((h: any) => Array.isArray(h?.settings?.configurations))
        // `?queue=` is the API's filter; checking membership again costs nothing and keeps
        // a hook that only names the queue in passing from counting.
        .filter((h: any) => (h.queues || []).some((u: unknown) => idOf(u) === queue.id))
        .map((h: any) => ({
          id: Number(h.id),
          name: String(h.name || ''),
          queueIds: (h.queues || []).map(idOf).filter((n: number | null) => n != null),
          configurations: h.settings.configurations,
        }));
    }
  }

  if (needs.has('rule')) {
    const res = await get(`/api/v1/rules?name=${encodeURIComponent(names.rule)}`);
    const r = (res?.results || []).find((x: any) => x?.name === names.rule);
    ctx.rule = r
      ? {
          id: Number(r.id),
          queueIds: (r.queues || []).map(idOf).filter((n: number | null) => n != null),
          condition: String(r.trigger_condition || ''),
          actions: Array.isArray(r.actions) ? r.actions : [],
        }
      : null;
  }

  if (needs.has('dataset')) {
    const list = await get(`${DS}/collections/list`, {
      method: 'POST',
      body: { filter: { name: names.dataset }, nameOnly: true },
      auth: 'bearer',
    });
    const exists = (list?.result || []).includes(names.dataset);
    let records: number | null = null;
    if (exists) {
      const agg = await get(`${DS}/data/aggregate`, {
        method: 'POST',
        body: { collectionName: names.dataset, pipeline: [{ $count: 'n' }] },
        auth: 'bearer',
      });
      records = Number(agg?.result?.[0]?.n ?? 0);
    }
    ctx.dataset = { exists, records };
  }

  if (needs.has('annotations')) {
    if (!queue) ctx.annotations = { count: 0, confirmedId: null };
    else {
      const all = await get(`/api/v1/annotations?queue=${queue.id}&page_size=1`);
      const count = Number(all?.pagination?.total ?? (all?.results || []).length);
      let confirmedId: number | null = null;
      if (count > 0) {
        const done = await get(
          `/api/v1/annotations?queue=${queue.id}&status=confirmed,exported&ordering=-modified_at&page_size=5`,
        );
        for (const a of done?.results || []) {
          const content = await get(`/api/v1/annotations/${Number(a.id)}/content`);
          if (hasVendorMatch(content)) {
            confirmedId = Number(a.id);
            break;
          }
        }
      }
      ctx.annotations = { count, confirmedId };
    }
  }

  return ctx;
}

export type CheckRun = { results: Record<string, Assertion[]>; build: Build };

/**
 * Checks every mission reached so far (`scope: 'current'`) or every task (`'all'`, the
 * receipt's last re-check). Rejects — a 429 included — on any failed read.
 */
export async function runChecks(
  track: Track,
  progress: Progress,
  get: Get,
  { scope = 'current' }: { scope?: 'current' | 'all' } = {},
): Promise<CheckRun> {
  // Every mission reached so far, not only the current one: work done in an earlier
  // mission can be undone (a deleted queue), and that has to show up where the trainee
  // is now, not first at the receipt.
  const tasks =
    scope === 'all'
      ? allTasks(track).map((x) => x.task)
      : reachedMissions(track, progress).flatMap((m) => m.tasks);
  const ctx = await loadContext(needsOf(tasks), progress.run, get);
  const results: Record<string, Assertion[]> = {};
  for (const task of tasks) {
    const as = evaluateTask(task, ctx);
    if (as) results[task.id] = as;
  }
  return { results, build: buildOf(ctx) };
}
