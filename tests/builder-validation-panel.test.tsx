// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'preact/test-utils';
import * as store from '../src/builder/store.js';
import { flatten } from '../src/builder/model.js';
import { annotationValues } from '../src/builder/values.js';
import type { PlacedMessage } from '../src/builder/validation.js';
import { setupBuilderScreen, root, chromeSet, row, openPicker } from './support/builderScreen.jsx';

setupBuilderScreen();

describe('Builder validation results', () => {
  it('shows messages on values, document messages, and fired rules', () => {
    act(() => {
      store.annotationId.value = 55;
      store.values.value = annotationValues([
        {
          category: 'section',
          schema_id: 'basic_section',
          children: [
            { category: 'datapoint', id: 101, schema_id: 'doc_id', content: { value: '' } },
          ],
        },
      ]);
      store.validation.value = {
        placed: {
          byField: new Map([
            ['doc_id', new Map([[0, [{ type: 'error', content: 'Missing', ruleId: 40 }]]])],
          ]),
          general: [{ type: 'warning', content: 'Duplicate document', ruleId: null }],
        },
        fired: new Set([40]),
        raw: {},
      };
    });
    expect(row('doc_id').querySelector('td[data-col="value"] [data-mark="error"]')).not.toBeNull();
    const doc = root.querySelector('[data-doc-row]') as HTMLElement;
    expect(doc.querySelector('td[data-col="value"]')!.textContent).toContain('Duplicate document');
    expect(root.querySelector('[data-validation-strip]')).toBeNull();
    const count = row('doc_id').querySelector('[data-action="field-rules"]') as HTMLElement;
    expect(count.dataset.fired).toBe('true');
    openPicker('rule');
    expect(root.querySelector('[data-picker="rule"] [data-option="40"]')!.textContent).toContain(
      'fired',
    );
    expect(root.querySelector('[data-action="revalidate"]')).not.toBeNull();
  });
});

describe('Builder: only fields with messages', () => {
  it('narrows the grid to fields that got a message, keeping their parents', () => {
    act(() => {
      store.annotationId.value = 55;
      store.values.value = annotationValues([]);
      store.validation.value = {
        placed: {
          byField: new Map([
            ['item_desc', new Map([[0, [{ type: 'warning', content: 'Odd', ruleId: null }]]])],
          ]),
          general: [],
        },
        fired: new Set(),
        raw: {},
      };
    });
    const toggle = root.querySelector('input[data-action="only-messages"]') as HTMLInputElement;
    expect(toggle.parentElement!.textContent).toContain('1');
    act(() => {
      toggle.click();
    });
    const shown = [...root.querySelectorAll('[data-row-key]')].map(
      (r) =>
        flatten(store.work.value).find((x) => x.key === r.getAttribute('data-row-key'))!.node.id,
    );
    expect(shown).toEqual(['items_section', 'items', 'item', 'item_desc']);
    expect(root.querySelector('[data-doc-row]')).toBeNull(); // no document-level messages
  });
});

describe('Builder validation panel', () => {
  function validated() {
    act(() => {
      store.annotationId.value = 55;
      store.values.value = annotationValues([]);
      store.validation.value = {
        placed: {
          byField: new Map<string, Map<number, PlacedMessage[]>>([
            ['doc_id', new Map([[0, [{ type: 'error', content: 'Doc id missing', ruleId: 40 }]]])],
            ['item_desc', new Map([[1, [{ type: 'warning', content: 'required', ruleId: null }]]])],
          ]),
          general: [{ type: 'info', content: 'Duplicate document', ruleId: null }],
        },
        fired: new Set([40]),
        raw: {},
      };
      store.rules.value = [
        ...store.rules.value,
        {
          id: 41,
          name: 'Quiet rule',
          enabled: true,
          trigger_condition: 'field.vendor',
          actions: [],
        },
      ];
      store.rightPanel.value = { kind: 'validation', tab: 'rules' };
    });
  }
  const panel = () => root.querySelector('aside[data-panel="validation"]') as HTMLElement;

  it('lists rules fired first with their messages, then the other messages by field', () => {
    validated();
    const rules = [...panel().querySelectorAll('[data-rule-result]')].map((e) => [
      e.getAttribute('data-rule-result'),
      e.getAttribute('data-fired'),
    ]);
    expect(rules).toEqual([
      ['40', 'true'],
      ['41', 'false'],
    ]);
    expect(panel().querySelector('[data-rule-result="40"]')!.textContent).toContain(
      'Doc id missing',
    );
    const others = [...panel().querySelectorAll('[data-other-message]')].map((e) => e.textContent!);
    expect(
      others.some((t) => t.includes('item_desc') && t.includes('row 2') && t.includes('required')),
    ).toBe(true);
    expect(others.some((t) => t.includes('Duplicate document'))).toBe(true);
  });

  it('clicking a rule opens it in rule mode, which closes the panel', () => {
    validated();
    act(() => {
      (panel().querySelector('[data-rule-result="40"] button') as HTMLElement).click();
    });
    expect(store.ruleEditor.value!.ruleId).toBe(40);
    expect(panel()).toBeNull();
  });

  it('Provenance replays each MDH configuration against the annotation', async () => {
    validated();
    const fetchMock = vi.fn(async (url: string, opts: any) => ({
      ok: true,
      status: 200,
      json: async () => {
        expect(url).toContain('/svc/data-storage/api/v1/data/aggregate');
        const body = JSON.parse(opts.body);
        return { result: JSON.stringify(body).includes('INV-9') ? [{ id: 1 }] : [] };
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    act(() => {
      store.annotationContent.value = [
        {
          category: 'section',
          schema_id: 'basic_section',
          children: [
            { category: 'datapoint', id: 101, schema_id: 'doc_id', content: { value: 'INV-9' } },
          ],
        },
      ];
    });
    act(() => {
      (panel().querySelector('[data-tab="provenance"]') as HTMLElement).click();
    });
    expect(store.rightPanel.value).toEqual({ kind: 'validation', tab: 'provenance' });
    await vi.waitFor(() =>
      expect(
        panel().querySelector('[data-provenance-config][data-outcome="matched"]'),
      ).not.toBeNull(),
    );
    const group = panel().querySelector('[data-provenance-hook]') as HTMLElement;
    expect(group.textContent).toContain('Vendor matching (70)');
    const cfg = panel().querySelector('[data-provenance-config]') as HTMLElement;
    expect(cfg.getAttribute('data-outcome')).toBe('matched');
    expect(cfg.textContent).toContain('1 hit');
    // details stay folded until the configuration is clicked
    expect(cfg.querySelector('[data-provenance-details]')).toBeNull();
    act(() => {
      (cfg.querySelector('[data-action="toggle-config"]') as HTMLElement).click();
    });
    expect(cfg.querySelector('[data-provenance-details]')).not.toBeNull();
    expect(cfg.querySelector('[data-query-status="winner"]')).not.toBeNull();
    // filters show only the outcomes present; picking one keeps just those configurations
    expect(panel().querySelector('[data-outcome-filter="nomatch"]')).toBeNull();
    act(() => {
      (panel().querySelector('[data-outcome-filter="matched"]') as HTMLElement).click();
    });
    expect(panel().querySelectorAll('[data-provenance-config]').length).toBe(1);
    // replayed once, not again on every re-render
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set: chromeSet } },
    });
  });
});
