// src/agent/replyJson.ts
// Finding the JSON an agent reply holds. Pure.

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
