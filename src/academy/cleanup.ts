// Start over › "Delete what I built": the ONE place training code writes to the
// org (owner, 2026-11-16), and only on the trainee's confirmed click. Everything
// else the Academy sends is a read; tests/training-write-boundary
// pins that every mutating call in training code lives in this file.
//
// It deletes only what THIS run built, found the way the checks find it — by
// the run's exact names — and never something another queue still uses:
//   - the rule named for the run,
//   - Master Data Hub hooks attached to the run's queue ONLY and reading its dataset,
//   - the queue, at once (`delete_after=0`), with its documents,
//   - its schema, when no other queue uses it,
//   - the dataset named for the run.
// The workspace is left alone: the trainee may have used an existing one.
import { namesFor } from '../training/track.js';
import { loadContext, type Get } from '../training/load.js';

export type RunObject = {
  kind: 'rule' | 'extension' | 'queue' | 'schema' | 'dataset';
  name: string;
  /** Absent for the dataset, which Data Storage addresses by name. */
  id?: number;
};

export type CleanupResult = {
  deleted: RunObject[];
  failed: Array<{ item: RunObject; message: string }>;
};

const DS = '/svc/data-storage/api/v1';

/** What this run built that is still in the org, in the order it must be deleted. */
export async function findRunObjects(run: string, get: Get): Promise<RunObject[]> {
  const names = namesFor(run);
  const ctx = await loadContext(new Set(['queue', 'schema', 'hooks', 'rule', 'dataset']), run, get);
  const out: RunObject[] = [];
  if (ctx.rule) out.push({ kind: 'rule', name: names.rule, id: ctx.rule.id });
  const queue = ctx.queue;
  for (const h of ctx.hooks || []) {
    const ours = h.configurations.some((c) => c?.source?.dataset === names.dataset);
    if (ours && queue && h.queueIds.length === 1 && h.queueIds[0] === queue.id) {
      out.push({ kind: 'extension', name: h.name || 'Master Data Hub', id: h.id });
    }
  }
  if (queue) out.push({ kind: 'queue', name: names.queue, id: queue.id });
  if (queue?.schemaPath && ctx.schema) {
    const schema = await get(queue.schemaPath);
    const users = (schema?.queues || []) as unknown[];
    const onlyOurs = users.every((u) => new RegExp(`/queues/${queue.id}/?$`).test(String(u)));
    if (onlyOurs)
      out.push({ kind: 'schema', name: String(schema?.name || 'schema'), id: ctx.schema.id });
  }
  if (ctx.dataset?.exists) out.push({ kind: 'dataset', name: names.dataset });
  return out;
}

function deleteOne(item: RunObject, get: Get): Promise<unknown> {
  switch (item.kind) {
    case 'rule':
      return get(`/api/v1/rules/${item.id}`, { method: 'DELETE' });
    case 'extension':
      return get(`/api/v1/hooks/${item.id}`, { method: 'DELETE' });
    case 'queue':
      return get(`/api/v1/queues/${item.id}?delete_after=0`, { method: 'DELETE' });
    case 'schema':
      return get(`/api/v1/schemas/${item.id}`, { method: 'DELETE' });
    case 'dataset':
      return get(`${DS}/collections/drop`, {
        method: 'POST',
        body: { collectionName: item.name },
        auth: 'bearer',
      });
  }
}

/** Deletes the items in order. A failure is recorded and the rest still run. */
export async function deleteRunObjects(items: RunObject[], get: Get): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: [], failed: [] };
  for (const item of items) {
    try {
      await deleteOne(item, get);
      result.deleted.push(item);
    } catch (e) {
      result.failed.push({ item, message: String((e as any)?.message || e) });
    }
  }
  return result;
}
