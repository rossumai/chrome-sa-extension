import { describe, it, expect } from 'vitest';
import { configRange } from '../src/builder/jsonRanges.js';

const settings = {
  other: { configurations: ['not this one'] },
  configurations: [
    { name: 'A {tricky} "quoted" \\\\ text', source: { queries: [{ find: { x: '{a}' } }] } },
    { name: 'B', mapping: { target_schema_id: 'b' } },
  ],
};
const text = JSON.stringify(settings, null, 2);

describe('configRange', () => {
  it('finds each top-level configuration, from its { to just after its }', () => {
    for (const i of [0, 1]) {
      const r = configRange(text, i)!;
      expect(text[r.from]).toBe('{');
      expect(text[r.to - 1]).toBe('}');
      expect(JSON.parse(text.slice(r.from, r.to))).toEqual(settings.configurations[i]);
    }
  });

  it('reads the legacy "configs" key too', () => {
    const t = JSON.stringify({ configs: [{ n: 1 }] });
    const r = configRange(t, 0)!;
    expect(t.slice(r.from, r.to)).toBe('{"n":1}');
  });

  it('is null when the JSON is broken or the configuration does not exist', () => {
    expect(configRange('{ "configurations": [ {', 0)).toBeNull();
    expect(configRange(text, 5)).toBeNull();
    expect(configRange('{"x": 1}', 0)).toBeNull();
  });
});
