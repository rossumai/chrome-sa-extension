// src/training/checks.ts
// PURE. Turns what the loader read (src/training/load.ts) into the assertions a
// task shows under "Done when". No DOM, no network, no chrome APIs — the Academy's
// checks and the receipt's last re-check both call this one function, so they
// cannot disagree about what passed.
//
// An assertion is 'ok', 'no' (with a `fix` saying exactly what to change) or
// 'pending' (an earlier object it depends on does not exist yet). Labels mark
// code with backticks; both surfaces render those as code spans.
import type { Names, Task } from './track.js';

export type AssertionState = 'ok' | 'no' | 'pending';
export type Assertion = { id: string; label: string; state: AssertionState; fix?: string };

export type SchemaField = { id: string; type: string | null; rir: string[] };

/** One hook with Master Data Hub settings. `configurations` is the raw MDH config list. */
export type HookInfo = { id: number; name: string; queueIds: number[]; configurations: any[] };

/**
 * What the loader read. A key that is `undefined` was not loaded in this run; `null` means
 * "loaded, and it does not exist".
 */
export type Ctx = {
  names: Names;
  queue?: { id: number; schemaPath: string | null } | null;
  schema?: { id: number; fields: SchemaField[] } | null;
  hooks?: HookInfo[];
  rule?: { id: number; queueIds: number[]; condition: string; actions: any[] } | null;
  dataset?: { exists: boolean; records: number | null };
  annotations?: { count: number; confirmedId: number | null };
};

/** The ids and counts the Academy's build board draws. Only loaded parts are present. */
export type Build = {
  queueId?: number | null;
  schemaId?: number | null;
  fields?: string[];
  hookId?: number | null;
  matchesOn?: 'vat' | 'other' | null;
  dataset?: boolean;
  records?: number | null;
  ruleId?: number | null;
  annotationId?: number | null;
  annotationCount?: number;
};

export const OUR_FIELDS = ['po_number', 'vendor_vat_id', 'vendor_match'];
export const MIN_RECORDS = 40;

const ok = (id: string, label: string): Assertion => ({ id, label, state: 'ok' });
const no = (id: string, label: string, fix: string): Assertion => ({ id, label, state: 'no', fix });
const pending = (id: string, label: string): Assertion => ({ id, label, state: 'pending' });
const check = (id: string, label: string, pass: boolean, fix: string) =>
  pass ? ok(id, label) : no(id, label, fix);

export const taskOk = (as: Assertion[] | null | undefined): boolean =>
  !!as && as.length > 0 && as.every((a) => a.state === 'ok');

/** The MDH configuration reading the trainee's dataset, on a hook attached to their queue. */
export function ourConfig(ctx: Ctx): { hook: HookInfo; config: any } | null {
  for (const hook of ctx.hooks || []) {
    const config = hook.configurations.find((c) => c?.source?.dataset === ctx.names.dataset);
    if (config) return { hook, config };
  }
  return null;
}

/** The `{placeholder}` names a query reads, in order. */
function placeholders(query: unknown): string[] {
  return [...JSON.stringify(query ?? null).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
}

/** True when the query reads `{vendor_vat_id}` and names the dataset key `vat_id`. */
export function matchesOnVat(query: unknown): boolean {
  const s = JSON.stringify(query ?? null);
  return s.includes('{vendor_vat_id}') && s.includes('"vat_id"');
}

const field = (ctx: Ctx, id: string) => ctx.schema?.fields.find((f) => f.id === id) || null;

/** The assertions for one task, or null for a task id this module does not know. */
export function evaluateTask(task: Task, ctx: Ctx): Assertion[] | null {
  const n = ctx.names;
  const queueLabel = `Your queue \`${n.queue}\` exists`;
  const needQueue = (id: string, label: string): Assertion[] | null =>
    ctx.queue ? null : [pending(id, label)];

  switch (task.id) {
    case 'kickoff.queue':
      return [
        check(
          'queue',
          queueLabel,
          !!ctx.queue,
          `No queue is named exactly \`${n.queue}\` yet. Create it, or rename yours to this name.`,
        ),
      ];

    case 'fields.extract': {
      // The template already reads both values, as `order_id` and `sender_vat_id`; the task
      // is to give those fields Acme's IDs. Each line says what to DO (owner, 2026-11-16:
      // "still reads the AI engine field `order_id`" described a property, not an action).
      // A field renamed in place keeps its AI engine field, which is what the check needs.
      const renamed = (label: string, from: string, to: string): Assertion => {
        const id = to === 'po_number' ? 'po' : 'vat';
        const text = `The ${label} field (\`${from}\`) has the ID \`${to}\``;
        if (!ctx.schema) return pending(id, text);
        const target = field(ctx, to);
        if (target && target.rir.includes(from)) return ok(id, text);
        if (target)
          return no(
            id,
            text,
            `Your \`${to}\` is a new field, so the AI does not fill it. Delete it, then change the ID of the existing ${label} field (\`${from}\`) to \`${to}\`.`,
          );
        if (field(ctx, from))
          return no(
            id,
            text,
            `Open the ${label} field (ID \`${from}\`) and change its ID to \`${to}\`.`,
          );
        return no(
          id,
          text,
          `Add a field with the ID \`${to}\`, and choose ${label} (\`${from}\`) as the AI value it reads.`,
        );
      };
      return [
        renamed('Order Number', 'order_id', 'po_number'),
        renamed('Vendor VAT Number', 'sender_vat_id', 'vendor_vat_id'),
      ];
    }

    case 'fields.match': {
      const wait = needQueue('match', 'The schema has `vendor_match`');
      if (wait) return wait;
      const match = field(ctx, 'vendor_match');
      return [
        check(
          'match',
          'The schema has `vendor_match`',
          !!match,
          'Add a field with the ID `vendor_match`.',
        ),
        match
          ? check(
              'match-enum',
              '`vendor_match` is a list field (type `enum`)',
              match.type === 'enum',
              `\`vendor_match\` is of type \`${match.type || 'unknown'}\`. Change its type to enum.`,
            )
          : pending('match-enum', '`vendor_match` is a list field (type `enum`)'),
      ];
    }

    case 'vendors.dataset':
      return [
        check(
          'dataset',
          `The dataset \`${n.dataset}\` exists`,
          !!ctx.dataset?.exists,
          `No dataset is named exactly \`${n.dataset}\` yet.`,
        ),
      ];

    case 'vendors.records': {
      const label = `It holds at least ${MIN_RECORDS} vendors`;
      if (!ctx.dataset?.exists) return [pending('records', label)];
      const count = ctx.dataset.records ?? 0;
      return [
        check(
          'records',
          label,
          count >= MIN_RECORDS,
          `It holds ${count}. Import every row of \`acme-vendors.csv\`.`,
        ),
      ];
    }

    case 'matching.hook': {
      const label = 'A Master Data Hub extension runs on your queue';
      const wait = needQueue('hook', label);
      if (wait) return wait;
      return [
        check(
          'hook',
          label,
          (ctx.hooks || []).length > 0,
          `No extension with matching settings is attached to \`${n.queue}\`. Add Master Data Hub from the Rossum Store and select your queue.`,
        ),
      ];
    }

    case 'matching.vat': {
      const readsLabel = `It reads the dataset \`${n.dataset}\``;
      const vatLabel = 'Its first query matches `vat_id` to `{vendor_vat_id}`';
      if (!ctx.queue || !(ctx.hooks || []).length)
        return [pending('reads', readsLabel), pending('vat', vatLabel)];
      const found = ourConfig(ctx);
      if (!found)
        return [
          no(
            'reads',
            readsLabel,
            `None of its configurations reads \`${n.dataset}\`. Set the dataset of one to this name.`,
          ),
          pending('vat', vatLabel),
        ];
      const first = found.config?.source?.queries?.[0];
      const used = placeholders(first);
      const fix = !first
        ? 'The configuration has no query yet. Add one that matches `vat_id`.'
        : used.length
          ? `Your first query reads \`{${used[0]}}\`. Move the VAT query to the top, or replace this one.`
          : 'Your first query reads no field of the invoice. Match `vat_id` to `{vendor_vat_id}`.';
      return [ok('reads', readsLabel), check('vat', vatLabel, matchesOnVat(first), fix)];
    }

    case 'matching.map': {
      const label = 'It writes the vendor into `vendor_match`';
      const keyLabel = 'The value is a key of the dataset (for example `id`)';
      const found = ctx.queue ? ourConfig(ctx) : null;
      if (!found) return [pending('map', label), pending('key', keyLabel)];
      const mapping = found.config?.mapping || {};
      return [
        check(
          'map',
          label,
          mapping.target_schema_id === 'vendor_match',
          mapping.target_schema_id
            ? `It writes into \`${mapping.target_schema_id}\`. Set the target field to \`vendor_match\`.`
            : 'Set the target field of the mapping to `vendor_match`.',
        ),
        check(
          'key',
          keyLabel,
          typeof mapping.dataset_key === 'string' && mapping.dataset_key.length > 0,
          'Set the dataset key of the mapping, for example `id`.',
        ),
      ];
    }

    case 'rules.create': {
      const exists = `The rule \`${n.rule}\` exists`;
      const onQueue = 'It runs on your queue';
      if (!ctx.rule)
        return [
          no('rule', exists, `No rule is named exactly \`${n.rule}\` yet.`),
          pending('queue', onQueue),
        ];
      return [
        ok('rule', exists),
        check(
          'queue',
          onQueue,
          !!ctx.queue && ctx.rule.queueIds.includes(ctx.queue.id),
          `Add \`${n.queue}\` to the rule's queues.`,
        ),
      ];
    }

    case 'rules.block': {
      const condLabel = 'Its condition reads `po_number`';
      const errLabel = 'It shows an error message';
      if (!ctx.rule) return [pending('condition', condLabel), pending('error', errLabel)];
      const actions = ctx.rule.actions || [];
      const shows = actions.filter((a) => a?.type === 'show_message' && a?.enabled !== false);
      const errorFix = shows.length
        ? `Its message is of type \`${shows[0]?.payload?.type || 'unknown'}\`. Change it to error, so it blocks confirmation.`
        : 'Add a Show message action of type error.';
      return [
        check(
          'condition',
          condLabel,
          /\bpo_number\b/.test(ctx.rule.condition || ''),
          'Write a condition that is true when the PO number is missing, for example `is_empty(field.po_number)`.',
        ),
        check(
          'error',
          errLabel,
          shows.some((a) => a?.payload?.type === 'error'),
          errorFix,
        ),
      ];
    }

    case 'golive.upload': {
      const label = 'Your queue holds at least one invoice';
      const wait = needQueue('upload', label);
      if (wait) return wait;
      return [
        check(
          'upload',
          label,
          (ctx.annotations?.count ?? 0) > 0,
          `Upload an invoice to \`${n.queue}\`.`,
        ),
      ];
    }

    case 'golive.confirm': {
      const label = 'An invoice is confirmed with `vendor_match` filled';
      const wait = needQueue('confirm', label);
      if (wait) return wait;
      return [
        check(
          'confirm',
          label,
          !!ctx.annotations?.confirmedId,
          'Open the invoice, check that `vendor_match` shows a vendor, and confirm it.',
        ),
      ];
    }

    default:
      return null;
  }
}

/** The build board's ids and counts, for the parts this run loaded. */
export function buildOf(ctx: Ctx): Build {
  const b: Build = {};
  if (ctx.queue !== undefined) b.queueId = ctx.queue?.id ?? null;
  if (ctx.schema !== undefined) {
    b.schemaId = ctx.schema?.id ?? null;
    b.fields = OUR_FIELDS.filter((id) => !!field(ctx, id));
  }
  if (ctx.hooks !== undefined) {
    const found = ourConfig(ctx);
    b.hookId = found?.hook.id ?? ctx.hooks[0]?.id ?? null;
    b.matchesOn = found
      ? matchesOnVat(found.config?.source?.queries?.[0])
        ? 'vat'
        : 'other'
      : null;
  }
  if (ctx.dataset !== undefined) {
    b.dataset = ctx.dataset.exists;
    b.records = ctx.dataset.records;
  }
  if (ctx.rule !== undefined) b.ruleId = ctx.rule?.id ?? null;
  if (ctx.annotations !== undefined) {
    b.annotationId = ctx.annotations.confirmedId;
    b.annotationCount = ctx.annotations.count;
  }
  return b;
}
