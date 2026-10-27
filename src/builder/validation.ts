// src/builder/validation.ts
// Reading a content/validate response: each message placed on the field and row of the
// datapoint it is anchored to (the rest are document-level), and which rules fired.

export type PlacedMessage = { type: string; content: string; ruleId: number | null };
export type PlacedMessages = {
  byField: Map<string, Map<number, PlacedMessage[]>>;
  general: PlacedMessage[];
};

/** `messages` as the API returns them — untyped on the wire. */
export function placeMessages(
  messages: any[] | null | undefined,
  ids: Map<number, { schemaId: string; row: number }>,
): PlacedMessages {
  const byField = new Map<string, Map<number, PlacedMessage[]>>();
  const general: PlacedMessage[] = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const msg: PlacedMessage = {
      type: String(m?.type ?? 'info'),
      content: String(m?.content ?? ''),
      ruleId: typeof m?.detail?.rule_id === 'number' ? m.detail.rule_id : null,
    };
    // The datapoint id may come as a number or a numeric string (the Inspector reads it as a string).
    const dp =
      typeof m?.id === 'number' ? m.id : /^\d+$/.test(String(m?.id ?? '')) ? Number(m.id) : null;
    const at = dp != null ? ids.get(dp) : undefined;
    if (!at) {
      general.push(msg);
      continue;
    }
    const rows = byField.get(at.schemaId) || new Map<number, PlacedMessage[]>();
    rows.set(at.row, [...(rows.get(at.row) || []), msg]);
    byField.set(at.schemaId, rows);
  }
  return { byField, general };
}

/** `matched_trigger_rules`: rule ids, rule URLs or rule objects, whichever the API sends. */
export function firedRuleIds(matched: unknown): Set<number> {
  const out = new Set<number>();
  const idOf = (x: any): number | null => {
    if (typeof x === 'number') return x;
    const s = typeof x === 'string' ? x : typeof x?.url === 'string' ? x.url : null;
    if (typeof x?.id === 'number') return x.id;
    const m = s ? /\/rules\/(\d+)\/?$/.exec(s) : null;
    return m ? Number(m[1]) : null;
  };
  for (const x of Array.isArray(matched) ? matched : []) {
    const id = idOf(x);
    if (id != null) out.add(id);
  }
  return out;
}

// Validation needs the document in `reviewing`: one in `to_review` is started first (and
// handed back afterwards); any other status is refused.
const REVIEWABLE = ['to_review', 'reviewing'];

/** Whether an annotation in `status` can be revalidated, and whether it must be started. */
export function revalidateStart(
  status: string,
): { ok: true; start: boolean } | { ok: false; error: string } {
  if (!REVIEWABLE.includes(status)) {
    return {
      ok: false,
      error: `Only a document in review can be revalidated (this one is ${status || 'unknown'}).`,
    };
  }
  return { ok: true, start: status === 'to_review' };
}
