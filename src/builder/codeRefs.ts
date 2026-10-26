// src/builder/codeRefs.ts
// Which hooks mention a field: a static, whole-word text search for the field id in a hook's
// code (`config.code`, function hooks) and settings (JSON). `doc_id` matches `field.doc_id`,
// `"doc_id"` and `{doc_id}`, not `doc_id_2`. A short, common id can match unrelated text —
// this points the user at places to look; it does not prove a use. MDH hooks are left to the
// Matching column; a webhook's code runs elsewhere, so only its settings are searched.

import { isMdhHook } from '../popup/mdh-provenance.js';

export type HookText = { code: string; settings: string };
export type CodeHit = { hook: any; inCode: boolean; inSettings: boolean };

const WORD = /[A-Za-z0-9_]+/g;

export function hookText(hook: any): HookText {
  const code = typeof hook?.config?.code === 'string' ? hook.config.code : '';
  const settings =
    hook?.settings && Object.keys(hook.settings).length
      ? JSON.stringify(hook.settings, null, 2)
      : '';
  return { code, settings };
}

/** Code the Builder cannot see: a webhook runs on its own server. */
export function codeHidden(hook: any): boolean {
  return hook?.type === 'webhook';
}

function words(text: string): Set<string> {
  return new Set(text.match(WORD) || []);
}

/** Per field id: the non-MDH hooks that mention it, and where. */
export function hooksByFieldText(hooks: any[], ids: string[]): Map<string, CodeHit[]> {
  const out = new Map<string, CodeHit[]>();
  for (const hook of hooks) {
    if (isMdhHook(hook)) continue;
    const t = hookText(hook);
    const code = words(t.code);
    const settings = words(t.settings);
    for (const id of ids) {
      const hit = { hook, inCode: code.has(id), inSettings: settings.has(id) };
      if (hit.inCode || hit.inSettings) out.set(id, [...(out.get(id) || []), hit]);
    }
  }
  return out;
}

/** Every whole-word occurrence of `id` in `text`, as [from, to) offsets. */
export function occurrences(text: string, id: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const m of text.matchAll(WORD)) {
    if (m[0] === id) out.push({ from: m.index!, to: m.index! + id.length });
  }
  return out;
}
