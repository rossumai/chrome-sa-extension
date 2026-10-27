// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'preact/test-utils';
import * as store from '../src/builder/store.js';
import { setAttr } from '../src/builder/model.js';
import { apply } from '../src/builder/index.jsx';
import {
  setupBuilderScreen,
  root,
  rowKey,
  row,
  openPicker,
  pickerOptions,
  pickIn,
} from './support/builderScreen.jsx';

setupBuilderScreen();

describe('Builder engine', () => {
  const ai = (id: string) =>
    (row(id).querySelector('td[data-col="ai"] [data-ai]') as HTMLElement | null)?.dataset.ai;
  const catalog = [
    { name: 'document_id', label: 'Document ID', type: 'string', tabular: false },
    { name: 'table_column_description', label: 'Description', type: 'string', tabular: true },
  ];
  const custom = () =>
    act(() => {
      store.engineCatalog.value = catalog;
      store.engineState.value = {
        kind: 'custom',
        engine: {
          id: 5,
          url: 'https://x/api/v1/engines/5',
          name: 'Inv engine',
          learning_enabled: true,
        },
        fields: [
          { id: 1, name: 'doc_id', type: 'string', pre_trained_field_id: 'document_id' },
          { id: 9, name: 'unused_f', type: 'string', pre_trained_field_id: null },
        ],
        error: null,
      };
    });

  it('the toolbar names the engine; hover lists engine fields the schema does not use', () => {
    custom();
    const badge = root.querySelector('[data-engine="custom"]') as HTMLElement;
    expect(badge.textContent).toBe('Engine: Inv engine (5)');
    expect(badge.title).toContain('not in this schema: unused_f');
  });

  it('the AI column shows each extracted field as seeded, learning or new', () => {
    custom();
    expect([ai('doc_id'), ai('vendor'), ai('item_desc')]).toEqual(['seeded', 'new', 'new']);
    expect(root.querySelector('[data-toolbar]')!.textContent).toContain('2 engine fields');
  });

  it('picking no seed in the field panel is one undoable edit', () => {
    custom();
    act(() => {
      row('doc_id').click();
    });
    expect(root.querySelector('[data-extraction="seeded"]')).not.toBeNull();
    pickIn('engine-seed', '');
    expect(root.querySelector('[data-extraction="learning"]')).not.toBeNull();
    expect(row('doc_id').dataset.status).toBe('edited');
    act(() => {
      (root.querySelector('[data-action="undo"]') as HTMLElement).click();
    });
    expect(root.querySelector('[data-extraction="seeded"]')).not.toBeNull();
  });

  it('a table column is offered only table-column seeds', () => {
    custom();
    act(() => {
      row('item_desc').click();
    });
    openPicker('engine-seed');
    expect(pickerOptions('engine-seed')).toEqual([
      'none — learns from documents',
      'table_column_description · Description',
    ]);
  });

  it('AI fields on a custom engine are marked and can be cleared from the panel', () => {
    custom();
    act(() => {
      apply(setAttr(store.work.value, rowKey('doc_id'), ['rir_field_names'], ['document_id']));
    });
    expect(row('doc_id').querySelector('[data-ai="rejected"]')).not.toBeNull();
    act(() => {
      row('doc_id').click();
    });
    act(() => {
      (root.querySelector('[data-action="clear-rir"]') as HTMLElement).click();
    });
    act(() => {
      store.selectedKey.value = null; // the AI column shows again once the panel closes
    });
    expect(ai('doc_id')).toBe('seeded');
  });

  const panel = () => root.querySelector('[data-panel="engine"]') as HTMLElement;
  const pickerValueIn = (el: HTMLElement) =>
    (el.querySelector('[data-picker="engine-seed"]') as HTMLElement).dataset.value;
  const pickInRow = (id: string, v: string) => {
    act(() => {
      (row(id).querySelector('[data-picker="engine-seed"] input') as HTMLInputElement).focus();
    });
    act(() => {
      row(id)
        .querySelector(`[data-option="${v}"]`)!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
  };

  it('a click on an AI cell opens the engine panel on extracted fields only', () => {
    custom();
    act(() => {
      apply(setAttr(store.work.value, rowKey('vendor'), ['ui_configuration'], { type: 'formula' }));
    });
    act(() => {
      (row('doc_id').querySelector('[data-action="open-engine"]') as HTMLElement).click();
    });
    expect(panel().textContent).toContain('Engine · Inv engine (5)');
    expect(store.selectedKey.value).toBe(rowKey('doc_id'));
    expect(panel().querySelector('[data-extraction="seeded"]')).not.toBeNull();
    expect(row('vendor')).toBeNull(); // a formula field: nothing to extract
    expect(row('item_desc')).not.toBeNull();
    // The AI column stays while the panel is open, as each row's seed picker.
    expect(pickerValueIn(row('doc_id'))).toBe('document_id');
  });

  it('a seed picked in the grid is one undoable edit that Save writes first', () => {
    custom();
    act(() => {
      (root.querySelector('[data-action="toggle-engine"]') as HTMLElement).click();
    });
    pickInRow('item_desc', 'table_column_description');
    expect(row('item_desc').dataset.status).toBe('edited');
    expect(panel().querySelector('[data-engine-save]')!.textContent).toContain('item_desc');
    expect(
      store.enginePlanNow.value!.create.find((c) => c.name === 'item_desc')!.pre_trained_field_id,
    ).toBe('table_column_description');
    act(() => {
      (root.querySelector('[data-action="undo"]') as HTMLElement).click();
    });
    expect(pickerValueIn(row('item_desc'))).toBe('');
  });

  it('shows the settings read-only and the training queues one per line', () => {
    custom();
    act(() => {
      store.queues.value = [
        { id: 77, name: 'Training', url: 'https://x/api/v1/queues/77' },
        ...store.queues.value,
      ];
      store.engineState.value = {
        ...store.engineState.value!,
        engine: {
          ...store.engineState.value!.engine,
          settings: { use_case: 'generic_ap' },
          training_queues: ['https://x/api/v1/queues/77'],
        },
      };
      store.rightPanel.value = { kind: 'engine' };
    });
    const settings = panel().querySelector('[data-engine-settings]')!.textContent;
    expect(settings).toContain('Use casegeneric_ap');
    expect(panel().querySelector('[data-engine-warning]')).toBeNull(); // facts, no verdicts
    expect(
      [...panel().querySelectorAll('[data-training-queue]')].map((r) => r.textContent),
    ).toEqual(['Training77']);
    expect(panel().querySelector('[data-engine-unused]')!.textContent).toContain('unused_f');
  });

  it('lists engine fields one per line: to write, used by other queues, used by none', () => {
    custom();
    act(() => {
      store.engineState.value = {
        ...store.engineState.value!,
        fields: [
          ...store.engineState.value!.fields,
          { id: 10, name: 'credit_ref', type: 'string', pre_trained_field_id: null },
        ],
      };
      store.engineUsers.value = {
        byName: new Map([['credit_ref', ['Credit notes (6)']]]),
        error: null,
      };
      store.rightPanel.value = { kind: 'engine' };
    });
    const rows = (sel: string) =>
      [...panel().querySelectorAll(`${sel} [data-engine-field]`)].map((r) => r.textContent);
    expect(rows('[data-engine-save]')).toEqual([
      'vendorcreate · learning',
      'item_desccreate · learning',
    ]);
    expect(rows('[data-engine-elsewhere]')).toEqual(['credit_refCredit notes (6)']);
    expect(rows('[data-engine-nowhere]')).toEqual(['unused_flearning✕']);
    act(() => {
      (panel().querySelector('[data-engine-field="vendor"]') as HTMLElement).click();
    });
    expect(store.selectedKey.value).toBe(rowKey('vendor'));
  });

  it('✕ marks an engine field no queue uses for deletion on Save; undo keeps it', () => {
    custom();
    act(() => {
      store.engineUsers.value = { byName: new Map(), error: null };
      store.rightPanel.value = { kind: 'engine' };
    });
    const before = store.engineChanges.value;
    const btn = () =>
      panel().querySelector(
        '[data-engine-field="unused_f"] [data-action="delete-engine-field"]',
      ) as HTMLElement;
    act(() => btn().click());
    expect(store.engineDeletesNow.value.map((f) => f.name)).toEqual(['unused_f']);
    expect(store.engineChanges.value).toBe(before + 1);
    expect(
      [...panel().querySelectorAll('[data-engine-save] [data-engine-field]')].pop()!.textContent,
    ).toBe('unused_fdelete');
    act(() => btn().click());
    expect(store.engineDeletesNow.value).toEqual([]);
    // Discard drops a marked delete with the schema edits.
    act(() => btn().click());
    act(() => {
      (root.querySelector('[data-action="discard"]') as HTMLElement).click();
    });
    expect(store.engineDeletes.value.size).toBe(0);
  });

  it('the AI chip shows the state only; the seed is on hover', () => {
    custom();
    const chip = row('doc_id').querySelector('[data-ai]') as HTMLElement;
    expect(chip.textContent).toBe('seeded');
    expect(chip.title).toContain('document_id');
  });

  it('Esc closes it without opening the field panel; the badge toggles it', () => {
    custom();
    act(() => {
      (row('doc_id').querySelector('[data-action="open-engine"]') as HTMLElement).click();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(panel()).toBeNull();
    expect(root.querySelector('[data-panel="field"]')).toBeNull();
    const badge = root.querySelector('[data-action="toggle-engine"]') as HTMLElement;
    act(() => badge.click());
    expect(badge.getAttribute('aria-pressed')).toBe('true');
    act(() => badge.click());
    expect(panel()).toBeNull();
  });

  it('on the generic engine, shows AI fields and adds one from the catalog', () => {
    act(() => {
      store.engineCatalog.value = catalog;
      store.engineState.value = { kind: 'generic', engine: null, fields: [], error: null };
    });
    expect(root.querySelector('[data-engine="generic"]')!.textContent).toBe('Generic engine');
    act(() => {
      row('doc_id').click();
    });
    pickIn('ai-catalog', 'document_id');
    expect(row('doc_id').querySelector('td[data-col="ai"]')).toBeNull(); // compact while open
    act(() => {
      store.selectedKey.value = null;
    });
    expect(row('doc_id').querySelector('td[data-col="ai"]')!.textContent).toBe('document_id');
  });
});
