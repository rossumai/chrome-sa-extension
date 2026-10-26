import { describe, it, expect } from 'vitest';
import { hooksByFieldText, occurrences, hookText, codeHidden } from '../src/builder/codeRefs.js';

const fn = {
  id: 1,
  type: 'function',
  name: 'Totals',
  config: {
    code: 'def rossum_hook_request_handler(payload):\n    x = field.doc_id\n    y = "doc_id_2"\n',
  },
  settings: {},
};
const exporter = {
  id: 2,
  type: 'function',
  name: 'Export',
  config: {},
  settings: { map: { vendor: '{doc_id}' } },
};
const web = {
  id: 3,
  type: 'webhook',
  name: 'ERP',
  config: { url: 'https://example.com' },
  settings: { fields: ['total'] },
};
const mdh = {
  id: 4,
  type: 'function',
  name: 'MDH',
  settings: { configurations: [{ source: { queries: [{ find: { a: '{doc_id}' } }] } }] },
};

describe('codeRefs', () => {
  it('finds a field id as a whole word in code and in settings, skipping MDH hooks', () => {
    const map = hooksByFieldText([fn, exporter, web, mdh], ['doc_id', 'doc_id_2', 'total', 'none']);
    expect(map.get('doc_id')!.map((h) => [h.hook.id, h.inCode, h.inSettings])).toEqual([
      [1, true, false],
      [2, false, true],
    ]);
    expect(map.get('doc_id_2')!.map((h) => h.hook.id)).toEqual([1]);
    expect(map.get('total')!.map((h) => h.hook.id)).toEqual([3]);
    expect(map.has('none')).toBe(false);
  });

  it('gives the offsets of each whole-word occurrence', () => {
    const t = 'a doc_id b doc_id_2 field.doc_id';
    expect(occurrences(t, 'doc_id').map((o) => t.slice(o.from, o.to))).toEqual([
      'doc_id',
      'doc_id',
    ]);
    expect(occurrences(t, 'doc_id')[1].from).toBe(t.lastIndexOf('doc_id'));
  });

  it('a webhook has no visible code; empty settings give no text', () => {
    expect(codeHidden(web)).toBe(true);
    expect(codeHidden(fn)).toBe(false);
    expect(hookText(fn).settings).toBe('');
  });
});
