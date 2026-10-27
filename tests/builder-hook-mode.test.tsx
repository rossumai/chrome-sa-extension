// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import * as store from '../src/builder/store.js';
import { flatten } from '../src/builder/model.js';
import {
  setupBuilderScreen,
  root,
  row,
  openPicker,
  pickerOptions,
  pickIn,
  pickerValue,
  pickRule,
} from './support/builderScreen.jsx';

setupBuilderScreen();

describe('Builder Matching column and hook mode', () => {
  const shown = () =>
    [...root.querySelectorAll('[data-row-key]')].map(
      (r) =>
        flatten(store.work.value).find((x) => x.key === r.getAttribute('data-row-key'))!.node.id,
    );
  const matchCount = (id: string) =>
    row(id).querySelector('td[data-col="matching"] [data-action="field-hooks"]')?.textContent ?? '';

  it('counts the MDH hooks per field; clicking opens hook mode', () => {
    expect(matchCount('doc_id')).toBe('1');
    expect(matchCount('vendor')).toBe('1');
    expect(matchCount('item_desc')).toBe('');
    act(() => {
      (row('doc_id').querySelector('[data-action="field-hooks"]') as HTMLElement).click();
    });
    expect(root.querySelector('aside[data-panel="hook"]')).not.toBeNull();
    expect(shown()).toEqual(['basic_section', 'doc_id', 'vendor']);
    expect(row('doc_id').querySelector('td[data-col="mdh"] [data-mark="in"]')).not.toBeNull();
    expect(row('vendor').querySelector('td[data-col="mdh"] [data-mark="out"]')).not.toBeNull();
    expect(row('doc_id').querySelector('[data-action="delete"]')).toBeNull();
    act(() => {
      (root.querySelector('[data-action="close-hook"]') as HTMLElement).click();
    });
    expect(root.querySelector('aside[data-panel="hook"]')).toBeNull();
    expect(root.querySelector('th[data-col="mdh"]')).toBeNull();
  });
});

describe('Builder hook mode: per configuration', () => {
  const shown = () =>
    [...root.querySelectorAll('[data-row-key]')].map(
      (r) =>
        flatten(store.work.value).find((x) => x.key === r.getAttribute('data-row-key'))!.node.id,
    );
  const badges = (id: string) =>
    [...row(id).querySelectorAll('td[data-col="mdh"] [data-mark]')].map((e) => e.textContent);

  it('numbers the configurations in the badges; picking one narrows the grid to it', () => {
    act(() => {
      store.hooks.value = [
        {
          id: 71,
          name: 'Two configs',
          settings: {
            configurations: [
              {
                name: 'A',
                source: { queries: [{ find: { x: '{doc_id}' } }] },
                mapping: { target_schema_id: 'vendor' },
              },
              {
                name: 'B',
                source: { queries: [{ find: { y: '{item_desc}' } }] },
                mapping: { target_schema_id: 'vendor' },
              },
            ],
          },
        },
      ];
    });
    act(() => {
      (row('doc_id').querySelector('[data-action="field-hooks"]') as HTMLElement).click();
    });
    expect(badges('doc_id')).toEqual(['in 1']);
    expect(badges('vendor')).toEqual(['out 1', 'out 2']);
    expect(shown()).toContain('item_desc');
    act(() => {
      const sel = root.querySelector('select[data-picker="config"]') as HTMLSelectElement;
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(shown()).toEqual([
      'basic_section',
      'vendor',
      'items_section',
      'items',
      'item',
      'item_desc',
    ]);
    expect(badges('vendor')).toEqual(['out 2']);
    act(() => {
      const sel = root.querySelector('select[data-picker="config"]') as HTMLSelectElement;
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(shown()).toContain('doc_id');
  });
});

describe('Builder hook mode: jump to a configuration', () => {
  it('clicking a configuration moves the editor to its { and flashes it', async () => {
    act(() => {
      store.hooks.value = [
        {
          id: 72,
          name: 'Jump',
          settings: {
            configurations: [
              { name: 'A', source: { queries: [{ find: { x: '{doc_id}' } }] } },
              { name: 'B', source: { queries: [{ find: { y: '{doc_id}' } }] } },
            ],
          },
        },
      ];
    });
    act(() => {
      (row('doc_id').querySelector('[data-action="field-hooks"]') as HTMLElement).click();
    });
    act(() => {
      const sel = root.querySelector('select[data-picker="config"]') as HTMLSelectElement;
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const view = EditorView.findFromDOM(
      root.querySelector('[data-code="hook"] .cm-editor') as HTMLElement,
    )!;
    const text = view.state.doc.toString();
    const head = view.state.selection.main.head;
    expect(text[head]).toBe('{');
    expect(text.slice(head, head + 20)).toContain('"name": "B"');
    expect(root.querySelector('[data-code="hook"] .cm-flash')).not.toBeNull();
  });
});

describe('Builder hooks that mention a field', () => {
  beforeEach(() => {
    act(() => {
      store.hooks.value = [
        ...store.hooks.value,
        {
          id: 80,
          type: 'function',
          name: 'Totals check',
          config: { code: 'def check(payload):\n    a = field.doc_id\n    b = field.doc_id\n' },
          settings: {},
        },
        { id: 81, type: 'webhook', name: 'ERP', config: {}, settings: { send: ['doc_id'] } },
      ];
    });
  });
  const cell = () => row('doc_id').querySelector('td[data-col="hooks"]') as HTMLElement;

  it('counts the non-MDH hooks that mention the field, leaving MDH to Matching', () => {
    expect(cell().textContent).toBe('2');
    expect(row('vendor').querySelector('td[data-col="hooks"]')!.textContent).toBe('');
  });

  it('picking one opens it read-only at the first mention; ↓ steps to the next', async () => {
    act(() => {
      (cell().querySelector('[data-action="field-code-hooks"]') as HTMLElement).click();
    });
    act(() => {
      (cell().querySelector('[data-code-hook-option="80"]') as HTMLElement).click();
    });
    const panel = root.querySelector('aside[data-panel="code"]') as HTMLElement;
    expect(panel.textContent).toContain('Totals check (80)');
    expect(panel.querySelector('[data-match]')!.textContent).toContain('1 of 2');
    expect(panel.querySelector('[data-action^="format-"]')).toBeNull(); // read-only: no Format
    const view = () =>
      EditorView.findFromDOM(
        panel.querySelector('[data-code="hook-view"] .cm-editor') as HTMLElement,
      )!;
    const text = view().state.doc.toString();
    expect(view().state.selection.main.head).toBe(text.indexOf('doc_id'));
    act(() => {
      (panel.querySelector('[data-action="next-match"]') as HTMLElement).click();
    });
    expect(view().state.selection.main.head).toBe(text.lastIndexOf('doc_id'));
    expect(view().state.readOnly).toBe(true);
  });

  it('a click on a grid row closes the hook view and shows that field', () => {
    act(() => {
      (cell().querySelector('[data-action="field-code-hooks"]') as HTMLElement).click();
    });
    act(() => {
      (cell().querySelector('[data-code-hook-option="80"]') as HTMLElement).click();
    });
    act(() => {
      row('vendor').click();
    });
    expect(root.querySelector('aside[data-panel="code"]')).toBeNull();
    expect(root.querySelector('aside[data-panel="field"]')).not.toBeNull();
  });

  it('a webhook opens on its settings and says its code is not visible', () => {
    act(() => {
      row('doc_id').click();
    });
    act(() => {
      (
        root.querySelector('[data-action="open-field-code-hook"][data-hook="81"]') as HTMLElement
      ).click();
    });
    const panel = root.querySelector('aside[data-panel="code"]') as HTMLElement;
    expect(panel.textContent).toContain('only its settings are searched');
    expect(panel.querySelector('[data-tab="code"]')).toBeNull();
    const view = EditorView.findFromDOM(panel.querySelector('.cm-editor') as HTMLElement)!;
    expect(view.state.doc.toString()).toContain('"send"');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(root.querySelector('aside[data-panel="code"]')).toBeNull();
  });
});

describe('Builder MDH hook filter', () => {
  it('picking a hook opens hook mode; the configuration filter appears; clearing closes it', () => {
    expect(root.querySelector('select[data-picker="config"]')).toBeNull();
    openPicker('hook');
    expect(pickerOptions('hook')).toEqual(['Vendor matching (70)']);
    pickIn('hook', '70');
    expect(root.querySelector('aside[data-panel="hook"]')).not.toBeNull();
    const cfg = root.querySelector('select[data-picker="config"]') as HTMLSelectElement;
    expect([...cfg.options].map((o) => o.textContent)).toEqual([
      'All configurations (1)',
      '1 · Configuration 1',
    ]);
    act(() => {
      (root.querySelector('[data-action="clear-hook"]') as HTMLElement).click();
    });
    expect(root.querySelector('aside[data-panel="hook"]')).toBeNull();
    expect(root.querySelector('select[data-picker="config"]')).toBeNull();
  });

  it('a rule and a hook close each other', () => {
    pickRule('40');
    pickIn('hook', '70');
    expect(store.ruleEditor.value).toBeNull();
    expect(pickerValue('rule')).toBe('');
    pickRule('40');
    expect(store.hookEditor.value).toBeNull();
    expect(pickerValue('hook')).toBe('');
  });
});
