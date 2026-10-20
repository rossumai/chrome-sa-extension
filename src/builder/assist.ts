// src/builder/assist.ts
// What Mr. Fabry's helpers in the Builder share: the schema's fields as prompt lines, finding
// the JSON in a reply, and one READ-ONLY agent turn (no mcpMode, cautious persona) — the
// agent proposes, the user decides. Injected transport, like src/audit/fabry.ts.
import { flatten, type Node } from './model.js';
import { newAcc, foldEvents, replyText } from '../agent/agentStream.js';

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

/** The JSON in a reply: a fenced block if there is one, else the outermost {...}. */
export function extractJson(text: string): string | null {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  if (fence) return fence[1];
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  return a >= 0 && b > a ? text.slice(a, b + 1) : null;
}

/** One turn: a new cautious chat the first time, the same chat for follow-ups. Read-only. */
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
