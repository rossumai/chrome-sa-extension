import { describe, it, expect } from 'vitest';
import { parseSettings } from '../src/builder/hookDraft.js';

describe('parseSettings', () => {
  it('accepts a JSON object', () => {
    expect(parseSettings('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('refuses text that does not parse, and JSON that is not an object', () => {
    expect(parseSettings('{').ok).toBe(false);
    expect(parseSettings('{')).toMatchObject({
      error: expect.stringMatching(/^The settings are not valid JSON: /),
    });
    for (const t of ['[]', 'null', '5']) {
      expect(parseSettings(t)).toEqual({ ok: false, error: 'The settings must be a JSON object' });
    }
  });
});
