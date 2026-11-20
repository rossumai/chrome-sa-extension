// @vitest-environment jsdom
// The provenance card on a queue that matches through LOOKUP FIELDS only — no MDH
// hook. Statuses come from the result the engine saved on the annotation, never
// from a replay (spec 2026-09-24-mdh-provenance-lookup-fields-design.md).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import MdhProvenancePanel from '../src/popup/components/MdhProvenancePanel.jsx';
import qiCss from '../src/popup/components/QueryItem.module.css';
import mpCss from '../src/popup/components/MdhProvenancePanel.module.css';
import cbCss from '../src/popup/components/ConfigBlock.module.css';

async function waitFor(cond: any, timeout = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const DOMAIN = 'https://org.rossum.app';
const TAB = { id: 1, windowId: 7, index: 0, url: `${DOMAIN}/document/5` };

const SCHEMA = [
  {
    category: 'section',
    id: 'items',
    children: [
      {
        category: 'multivalue',
        id: 'line_items',
        children: {
          category: 'tuple',
          id: 'line_item',
          children: [
            { category: 'datapoint', id: 'item_uom', type: 'string' },
            {
              category: 'datapoint',
              id: 'item_uom_match',
              label: 'UoM',
              ui_configuration: { type: 'lookup' },
              matching: {
                type: 'master_data_hub',
                configuration: {
                  dataset: 'uoms',
                  queries: [
                    { '//': 'Exact code', aggregate: [{ $match: { code: '$$uom' } }] },
                    { '//': 'Name prefix', aggregate: [{ $match: { name: '$$uom' } }] },
                  ],
                  variables: { uom: { __formula: 'field.item_uom' } },
                },
              },
            },
          ],
        },
      },
    ],
  },
];

const opt = (value: string, q: number) => ({ value, label: value, struct: { __query_index: q } });
const row = (uom: string, match: any) => ({
  category: 'tuple',
  schema_id: 'line_item',
  children: [
    { category: 'datapoint', schema_id: 'item_uom', content: { value: uom } },
    { category: 'datapoint', schema_id: 'item_uom_match', ...match },
  ],
});
const CONTENT = {
  content: [
    {
      category: 'section',
      schema_id: 'items',
      children: [
        {
          category: 'multivalue',
          schema_id: 'line_items',
          children: [
            row('hours', { content: { value: 'HR' }, options: [opt('HR', 1)] }),
            row('EA', { content: { value: 'EA' }, options: [opt('EA', 0)] }),
            row('zzz', { content: { value: '' } }),
          ],
        },
      ],
    },
  ],
};

let root: any;
let fetchMock: any;
let schemaContent: any;
let hooksResp: any;

beforeEach(() => {
  schemaContent = SCHEMA;
  hooksResp = { results: [] };
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.stubGlobal('chrome', {
    scripting: {
      executeScript: vi.fn(async () => [
        { result: { token: 'tok', domain: DOMAIN, annotationId: '5', queueId: '42' } },
      ]),
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn((_obj: any, cb?: any) => cb?.()) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    },
    tabs: { create: vi.fn() },
    runtime: { sendMessage: vi.fn(), getURL: (p: string) => `chrome-extension://x/${p}` },
  });
  fetchMock = vi.fn(async (url: string) => {
    const body = (() => {
      if (url.includes('/api/v1/hooks?')) return hooksResp; // default: no MDH hook at all
      if (url.includes('/data/aggregate')) return { result: [] };
      if (url.includes('evaluate_formulas'))
        return {
          annotation_content: [
            {
              category: 'section',
              children: [
                {
                  category: 'multivalue',
                  schema_id: 'line_items',
                  children: ['hours', 'EA', 'zzz'].map((v) => ({
                    category: 'tuple',
                    children: [{ schema_id: '__var__uom', content: { value: v } }],
                  })),
                },
              ],
            },
          ],
        };
      if (url.includes('/content')) return CONTENT;
      if (url.includes('/api/v1/queues/')) return { schema: `${DOMAIN}/api/v1/schemas/9` };
      if (url.includes('/api/v1/schemas/9')) return { content: schemaContent };
      return {};
    })();
    return { ok: true, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

const STATUS_KEYS = [
  'mdhQStatusPending',
  'mdhQStatusWinner',
  'mdhQStatusEmpty',
  'mdhQStatusSkipped',
  'mdhQStatusGated',
  'mdhQStatusError',
];

const statusClasses = () =>
  [...root.querySelectorAll(`.${qiCss.mdhQStatus}`)].map((n: any) =>
    // The status modifier's module key, read back from the class. Listed, not enumerated:
    // vitest's CSS Module object has no enumerable keys.
    STATUS_KEYS.find((k) => n.classList.contains(qiCss[k])),
  );

describe('MDH provenance — lookup fields', () => {
  it('shows a lookup-only queue instead of "No MDH matching hooks"', async () => {
    render(<MdhProvenancePanel tab={TAB} />, root);
    await waitFor(() => root.querySelector(`.${cbCss.mdhCfgSource}`));
    expect(root.textContent).not.toContain('No MDH matching');
    expect(root.querySelector(`.${cbCss.mdhQTarget}`).textContent).toBe('item_uom_match');
    const source = root.querySelector(`.${cbCss.mdhCfgSource}`);
    expect(source.textContent).toBe('Lookup field · UoM');
    expect(source.querySelector('a').getAttribute('href')).toBe(
      `${DOMAIN}/queues/42/settings/fields/item_uom_match`,
    );
  });

  it('reads the saved winner per row and never replays against Data Storage', async () => {
    render(<MdhProvenancePanel tab={TAB} />, root);
    await waitFor(() => root.querySelector(`.${cbCss.mdhRowSelect}`));
    expect(statusClasses()).toEqual(['mdhQStatusEmpty', 'mdhQStatusWinner']);

    const select = root.querySelector(`.${cbCss.mdhRowSelect}`);
    expect(select.querySelectorAll('option')).toHaveLength(3);
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    await waitFor(() => statusClasses()[0] === 'mdhQStatusWinner');
    expect(statusClasses()).toEqual(['mdhQStatusWinner', 'mdhQStatusSkipped']);

    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await waitFor(() => statusClasses()[0] === 'mdhQStatusEmpty');
    expect(statusClasses()).toEqual(['mdhQStatusEmpty', 'mdhQStatusEmpty']);

    expect(fetchMock.mock.calls.some(([u]: any) => u.includes('/data/aggregate'))).toBe(false);
  });

  it('opens the query with the selected row’s variable values', async () => {
    render(<MdhProvenancePanel tab={TAB} />, root);
    await waitFor(() => root.querySelector(`.${cbCss.mdhRowSelect}`));
    const select = root.querySelector(`.${cbCss.mdhRowSelect}`);
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    await waitFor(() => statusClasses()[0] === 'mdhQStatusWinner');

    root.querySelectorAll('.mdh-q-open')[0].click();
    const set = (globalThis as any).chrome.storage.local.set;
    await waitFor(() => set.mock.calls.length > 0);
    const staged: any = Object.values(set.mock.calls[0][0])[0];
    expect(staged.pendingCollection).toBe('uoms');
    expect(staged.pendingVariables).toEqual({ uom: 'EA' });
    expect(staged.pendingVariableTypes).toEqual({});
    expect(JSON.parse(staged.pendingPipeline)).toEqual([{ $match: { code: '$$uom' } }]);
  });

  it('interleaves hook and lookup cfgs by their targets’ schema order', async () => {
    // Schema: header_mdh (header) … item_uom_match, item_uom_mdh (in the table).
    const tuple = SCHEMA[0].children[0].children as any;
    schemaContent = [
      { category: 'section', id: 'h', children: [{ category: 'datapoint', id: 'header_mdh' }] },
      {
        ...SCHEMA[0],
        children: [
          {
            ...SCHEMA[0].children[0],
            children: {
              ...tuple,
              children: [...tuple.children, { category: 'datapoint', id: 'item_uom_mdh' }],
            },
          },
        ],
      },
    ];
    const cfg = (target: string) => ({
      name: `cfg ${target}`,
      mapping: { target_schema_id: target },
      source: { dataset: 'uoms', queries: [{ find: { code: '{item_uom}' } }] },
    });
    // The hook lists them in the OPPOSITE order to the schema.
    hooksResp = {
      results: [
        {
          id: 900,
          name: 'MDH hook',
          active: true,
          type: 'webhook',
          settings: { configurations: [cfg('item_uom_mdh'), cfg('header_mdh')] },
        },
      ],
    };
    render(<MdhProvenancePanel tab={TAB} />, root);
    await waitFor(() => root.querySelectorAll(`.${cbCss.mdhQTarget}`).length === 3);
    const targets = [...root.querySelectorAll(`.${cbCss.mdhQTarget}`)].map(
      (n: any) => n.textContent,
    );
    expect(targets).toEqual(['header_mdh', 'item_uom_match', 'item_uom_mdh']);
    const sources = [...root.querySelectorAll(`.${cbCss.mdhCfgSource} a`)].map(
      (n: any) => n.textContent,
    );
    expect(sources).toEqual(['MDH hook', 'Lookup field', 'MDH hook']);
  });

  it('says so when a queue has neither hooks nor lookup fields', async () => {
    schemaContent = [];
    render(<MdhProvenancePanel tab={TAB} />, root);
    // "Loading…" shares .mdh-empty, so wait for the message itself.
    await waitFor(() => root.querySelector(`.${mpCss.mdhEmpty}`)?.textContent !== 'Loading…');
    expect(root.querySelector(`.${mpCss.mdhEmpty}`).textContent).toBe(
      'No MDH matching on this queue.',
    );
  });
});
