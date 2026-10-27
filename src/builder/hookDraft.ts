// src/builder/hookDraft.ts
// The hook editor's text: an MDH hook's settings as JSON. Pure.

/** The editor's text as settings: valid JSON holding an object, or why not. */
export function parseSettings(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (err: any) {
    return {
      ok: false,
      error: `The settings are not valid JSON: ${err?.message || 'parse error'}`,
    };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, error: 'The settings must be a JSON object' };
  }
  return { ok: true, value: v as Record<string, unknown> };
}
