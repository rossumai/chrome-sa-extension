// src/builder/jsonRanges.ts
// Where a hook's N-th match configuration sits in its settings JSON text: from its "{" to just
// after its "}". A small position-tracking scan of the whole document (strings and escapes
// respected, so a "{" inside a name cannot fool it); null when the text is not valid JSON.

type Span = { from: number; to: number };

// The scanner, over one text. Each step takes a position and returns the one after what it
// read; anything that is not valid JSON throws.
function scanner(t: string) {
  const ws = (i: number): number => {
    while (i < t.length && /\s/.test(t[i])) i++;
    return i;
  };
  const str = (i: number): number => {
    if (t[i] !== '"') throw 0;
    for (let j = i + 1; j < t.length; j++) {
      if (t[j] === '\\') j++;
      else if (t[j] === '"') return j + 1;
    }
    throw 0;
  };
  // One value starting at i; `items`, when given, receives each element's span of an array.
  const value = (i: number, items?: Span[]): number => {
    i = ws(i);
    const c = t[i];
    if (c === '"') return str(i);
    if (c === '{') return object(i);
    if (c === '[') {
      let j = ws(i + 1);
      if (t[j] === ']') return j + 1;
      for (;;) {
        const from = ws(j);
        const to = value(from);
        items?.push({ from, to });
        j = ws(to);
        if (t[j] === ']') return j + 1;
        if (t[j] !== ',') throw 0;
        j++;
      }
    }
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(t.slice(i));
    if (!m) throw 0;
    return i + m[0].length;
  };
  // An object at i; `onKey` sees each key and may ask for its (array) value's element spans.
  const object = (i: number, onKey?: (key: string) => Span[] | undefined): number => {
    let j = ws(i + 1);
    if (t[j] === '}') return j + 1;
    for (;;) {
      j = ws(j);
      const kEnd = str(j);
      const key = JSON.parse(t.slice(j, kEnd));
      j = ws(kEnd);
      if (t[j] !== ':') throw 0;
      j = ws(value(j + 1, onKey?.(key)));
      if (t[j] === '}') return j + 1;
      if (t[j] !== ',') throw 0;
      j++;
    }
  };
  return { ws, object };
}

/** The text span of `settings.configurations[index]` (or legacy `configs`), or null. */
export function configRange(text: string, index: number): Span | null {
  const scan = scanner(text);
  const found: Record<string, Span[]> = {};
  try {
    const start = scan.ws(0);
    if (text[start] !== '{') return null;
    const end = scan.object(start, (key) =>
      key === 'configurations' || key === 'configs' ? (found[key] = []) : undefined,
    );
    if (scan.ws(end) !== text.length) return null;
  } catch {
    return null;
  }
  const list = found.configurations ?? found.configs;
  return list && index >= 0 && index < list.length ? list[index] : null;
}
