import { describe, it, expect } from 'vitest';
import { parseHookReply } from '../src/builder/hookAssist.js';

const ids = new Set(['doc_id', 'vendor']);
const settings = {
  configurations: [
    {
      source: { dataset: 'v', queries: [{ find: { vat: '{doc_id}' } }] },
      mapping: { dataset_key: 'id', target_schema_id: 'vendor' },
    },
  ],
};

describe('parseHookReply', () => {
  it('reads the settings object out of a fenced reply', () => {
    const r = parseHookReply('Here:\n```json\n' + JSON.stringify(settings) + '\n```', ids);
    expect(r).toEqual({ ok: true, settings, warnings: [] });
  });

  it('unwraps {"settings": …} when the wrapper is all there is', () => {
    expect(parseHookReply(JSON.stringify({ settings }), ids)).toMatchObject({ ok: true, settings });
  });

  it('refuses an array', () => {
    expect(parseHookReply('```json\n[{"a": 1}]\n```', ids)).toEqual({
      ok: false,
      error: 'Mr. Fabry did not return hook settings',
    });
  });

  it('refuses JSON that does not parse', () => {
    expect(parseHookReply('{"configurations": [}', ids)).toEqual({
      ok: false,
      error: 'Mr. Fabry returned settings that are not valid JSON',
    });
  });
});
