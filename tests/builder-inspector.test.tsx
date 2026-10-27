// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import * as store from '../src/builder/store.js';
import { withKeys } from '../src/builder/model.js';
import { section, dp, rowOf } from './support/builder.js';
import { setupBuilderScreen, root, rowKey, row } from './support/builderScreen.jsx';

setupBuilderScreen();

describe('Builder formula editor', () => {
  function openFormula() {
    act(() => {
      store.startDraft(
        'Invoice schema',
        withKeys([
          section(
            's',
            [
              dp('total_check', {
                label: 'Check',
                type: 'number',
                ui_configuration: { type: 'formula' },
                formula: 'field.a+field.b',
              }),
            ],
            { label: 'S' },
          ),
        ]),
      );
      store.selectedKey.value = rowKey('total_check');
    });
  }

  it('shows the formula in a Python code editor', () => {
    openFormula();
    const box = root.querySelector('[data-code="formula"]')!;
    expect(box.querySelector('.cm-editor')).not.toBeNull();
    expect(box.querySelector('.cm-content')!.textContent).toBe('field.a+field.b');
  });

  it('Format replaces the formula with the formatted code as one undoable edit', async () => {
    openFormula();
    (window as any).__builderRuffFormat = async (src: string) => src.replace('+', ' + ') + '\n';
    await act(async () => {
      (root.querySelector('[data-action="format-formula"]') as HTMLElement).click();
    });
    const formula = () => rowOf(store.work.value, 'total_check').node.formula;
    await vi.waitFor(() => expect(formula()).toBe('field.a + field.b'));
    expect(store.history.value.past.length).toBe(1);
    delete (window as any).__builderRuffFormat;
  });

  it('Expand makes the formula editor fill the inspector, and collapses back', () => {
    openFormula();
    const aside = () => root.querySelector('aside') as HTMLElement;
    expect(aside().textContent).toContain('Description');
    act(() => {
      (root.querySelector('[data-action="expand-formula"]') as HTMLElement).click();
    });
    expect(aside().dataset.expanded).toBe('true');
    expect(aside().textContent).not.toContain('Description');
    expect(aside().querySelector('.cm-editor')).not.toBeNull();
    act(() => {
      (root.querySelector('[data-action="expand-formula"]') as HTMLElement).click();
    });
    expect(aside().dataset.expanded).toBeUndefined();
  });
});

describe('Builder inspector visibility', () => {
  const aside = () => root.querySelector('aside');

  it('appears when a row is clicked and hides on a click into empty grid space', () => {
    expect(aside()).toBeNull();
    act(() => {
      row('doc_id').click();
    });
    expect(aside()).not.toBeNull();
    act(() => {
      (root.querySelector('[data-grid-wrap]') as HTMLElement).click();
    });
    expect(aside()).toBeNull();
    expect(store.selectedKey.value).toBeNull();
  });

  it('hides on its ✕ button', () => {
    act(() => {
      row('doc_id').click();
    });
    act(() => {
      (root.querySelector('[data-action="close-field"]') as HTMLElement).click();
    });
    expect(root.querySelector('aside[data-panel="field"]')).toBeNull();
    expect(store.selectedKey.value).toBeNull();
  });

  it('hides on Esc when not typing', () => {
    act(() => {
      row('doc_id').click();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(aside()).toBeNull();
  });

  it('stays open for a click on a grid button, such as + Field', () => {
    act(() => {
      (root.querySelector('[data-action="add-field"]') as HTMLElement).click();
    });
    expect(store.selectedKey.value).not.toBeNull();
    expect(aside()).not.toBeNull();
  });
});

describe('Builder shortcuts inside a code editor', () => {
  it('⌘Z and Esc typed in CodeMirror leave the schema history and the panel alone', () => {
    act(() => {
      (row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement).click();
    });
    act(() => {
      (row('doc_id').querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    const cm = root.querySelector('[data-code="condition"] .cm-content') as HTMLElement;
    act(() => {
      cm.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
      cm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(store.history.value.past.length).toBe(1);
    expect(store.ruleEditor.value).not.toBeNull();
  });
});

describe('Builder field inspector: Mr. Fabry box', () => {
  it('shows an Ask box for a field, also in the expanded formula editor', () => {
    act(() => {
      row('doc_id').click();
    });
    expect(
      root.querySelector('aside[data-panel="field"] textarea[data-fabry-prompt]'),
    ).not.toBeNull();
    act(() => {
      store.startDraft(
        'Invoice schema',
        withKeys([
          section(
            's',
            [
              dp('f', {
                label: 'F',
                type: 'number',
                ui_configuration: { type: 'formula' },
                formula: '1',
              }),
            ],
            { label: 'S' },
          ),
        ]),
      );
      store.selectedKey.value = rowKey('f');
    });
    act(() => {
      (root.querySelector('[data-action="expand-formula"]') as HTMLElement).click();
    });
    expect(
      root.querySelector('aside[data-expanded="true"] textarea[data-fabry-prompt]'),
    ).not.toBeNull();
  });
});

describe('Builder field panel: used by', () => {
  const links = () => root.querySelector('[data-field-links]') as HTMLElement;
  const open = (id: string) =>
    act(() => {
      row(id).click();
    });

  it('lists the rules and MDH configurations that use the field', () => {
    open('doc_id');
    const rule = links().querySelector('[data-action="open-field-rule"]') as HTMLElement;
    expect(rule.dataset.rule).toBe('40');
    expect(rule.textContent).toContain('Doc ID present (40)');
    expect(rule.textContent).toContain('if');
    const cfg = links().querySelector('[data-hook="70"] [data-action="open-field-config"]')!;
    expect(cfg.textContent).toContain('1 · Configuration 1');
    expect(cfg.textContent).toContain('in');
  });

  it('a rule opens in the rule editor; + New rule starts one from the field', () => {
    open('doc_id');
    act(() => {
      (links().querySelector('[data-action="open-field-rule"]') as HTMLElement).click();
    });
    expect(store.ruleEditor.value!.ruleId).toBe(40);
    act(() => {
      (root.querySelector('[data-action="clear-rule"]') as HTMLElement).click();
    });
    open('doc_id');
    act(() => {
      (links().querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('field.doc_id');
  });

  it('a configuration opens the hook narrowed to it, with the editor on its {', async () => {
    act(() => {
      store.hooks.value = [
        {
          id: 72,
          name: 'Jump',
          settings: {
            configurations: [
              { name: 'A', source: { queries: [{ find: { x: '{vendor}' } }] } },
              { name: 'B', source: { queries: [{ find: { y: '{doc_id}' } }] } },
            ],
          },
        },
      ];
    });
    open('doc_id');
    act(() => {
      (links().querySelector('[data-config="1"]') as HTMLElement).click();
    });
    expect(store.hookEditor.value!.hookId).toBe(72);
    expect(store.hookConfigIndex.value).toBe(1);
    const view = EditorView.findFromDOM(
      root.querySelector('[data-code="hook"] .cm-editor') as HTMLElement,
    )!;
    const text = view.state.doc.toString();
    expect(
      text.slice(view.state.selection.main.head, view.state.selection.main.head + 20),
    ).toContain('"name": "B"');
  });

  it('shows Rules (0) for a field no rule uses', () => {
    open('vendor');
    expect(links().textContent).toContain('Rules (0)');
    expect(links().querySelectorAll('[data-action="open-field-rule"]').length).toBe(0);
  });
});
