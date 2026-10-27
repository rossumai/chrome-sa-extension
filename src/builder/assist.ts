// src/builder/assist.ts
// What Mr. Fabry's helpers in the Builder share: the schema's fields as prompt lines, finding
// the JSON in a reply, and one READ-ONLY agent turn (no mcpMode, cautious persona) — the
// agent proposes, the user decides. Injected transport, like src/audit/fabry.ts.
import { flatten, type Node } from './model.js';
import { newAcc, foldEvents, replyText } from '../agent/agentStream.js';
import { firstJsonObject } from '../agent/replyJson.js';
import { MAX_PROMPT } from '../inspector/promptBudget.js';

export type FieldInfo = { id: string; label: string; type: string; table: string | null };

/** The schema's fields for the prompt: datapoints and tables, with each column's table. */
export function schemaFieldList(nodes: Node[]): FieldInfo[] {
  const rows = flatten(nodes);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const tableOf = (parentKey: string | null): string | null => {
    for (let k = parentKey; k; k = byKey.get(k)?.parentKey ?? null) {
      const r = byKey.get(k)!;
      if (r.kind === 'multivalue') return String(r.node.id);
    }
    return null;
  };
  return rows
    .filter((r) => !r.deleted && (r.kind === 'datapoint' || r.kind === 'multivalue'))
    .map((r) => ({
      id: String(r.node.id),
      label: String(r.node.label ?? ''),
      type: r.kind === 'multivalue' ? 'table' : String(r.node.type ?? 'string'),
      table: tableOf(r.parentKey),
    }));
}

export function fieldLines(fields: FieldInfo[]): string {
  return fields
    .map((f) => `- ${f.id}: ${f.label} (${f.type}${f.table ? `, column of table ${f.table}` : ''})`)
    .join('\n');
}

/** Attributes no assistant may set on a schema node: structure and Builder's own markers. */
export const NEVER_SET = ['category', 'children', '__key', '__deleted', '__engine'];

/**
 * The JSON in a reply: a fenced block if there is one; else the whole reply when it is a bare
 * array (so a caller can refuse it, rather than take its first element); else the first
 * complete {...} object.
 */
function extractJson(text: string): string | null {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  if (fence) return fence[1];
  const bare = text.trim();
  return bare.startsWith('[') ? bare : firstJsonObject(text);
}

/** The JSON object in a reply, or the failure: `none` (no JSON, or not an object), `invalid`. */
export function parseReplyObject(
  text: string,
  errors: { none: string; invalid: string },
): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  const raw = extractJson(text);
  if (!raw) return { ok: false, error: errors.none };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: errors.invalid };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: errors.none };
  }
  return { ok: true, value: value as Record<string, any> };
}

/**
 * One turn: a new cautious chat the first time, the same chat for follow-ups. Read-only.
 * A prompt over MAX_PROMPT is refused before anything is sent.
 */
export async function runAssist({
  agentApi,
  chatId,
  content,
  signal,
}: {
  agentApi: any;
  chatId: string | null;
  content: string;
  signal?: AbortSignal;
}): Promise<{ chatId: string; text: string }> {
  if (content.length > MAX_PROMPT) {
    throw new Error(
      `This is too large to send to Mr. Fabry in one message (${content.length} characters; the limit is ${MAX_PROMPT}).`,
    );
  }
  let id = chatId;
  if (!id) {
    id = (await agentApi.createChat()) as string;
    await agentApi.streamMessage(id, '/persona cautious', { onEvent: () => {}, signal });
  }
  const acc = newAcc();
  await agentApi.streamMessage(id, content, {
    signal,
    onEvent: (ev: unknown) => foldEvents(acc, [ev]),
  });
  return { chatId: id, text: replyText(acc) };
}
