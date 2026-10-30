// src/builder/hookDraft.ts
// The hook editor's text: an MDH hook's settings as JSON. Pure.
import { parseJsonObject } from '../agent/replyJson.js';

/** The editor's text as settings: valid JSON holding an object, or why not. */
export function parseSettings(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const r = parseJsonObject(text);
  if (r.ok) return r;
  return {
    ok: false,
    error:
      r.syntaxError != null
        ? `The settings are not valid JSON: ${r.syntaxError}`
        : 'The settings must be a JSON object',
  };
}
