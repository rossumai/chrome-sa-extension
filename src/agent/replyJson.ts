// src/agent/replyJson.ts
// Finding the JSON an agent reply holds, and reading a JSON object. Pure.

// The first complete brace-balanced {…} object in the text (string-aware), so a
// trailing '}' in prose after the JSON can't make extraction overshoot.
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Text as a JSON object (not an array or null): the value, or the parse error's message
 *  (null when it parsed but is not an object). */
export function parseJsonObject(
  text: string,
): { ok: true; value: Record<string, any> } | { ok: false; syntaxError: string | null } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err: any) {
    return { ok: false, syntaxError: err?.message || 'parse error' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, syntaxError: null };
  }
  return { ok: true, value: value as Record<string, any> };
}
