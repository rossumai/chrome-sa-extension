// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/builder/components/App.jsx';
import * as store from '../src/builder/store.js';
import { withKeys, flatten } from '../src/builder/model.js';
import { annotationValues } from '../src/builder/values.js';
import type { PlacedMessage } from '../src/builder/validation.js';
import { apply } from '../src/builder/index.jsx';
import { setAttr } from '../src/builder/model.js';
import { navDrawer, panelWide } from '../src/builder/components/panels.js';

function content(): any[] {
  return [
    {
      category: 'section',
      id: 'basic_section',
      label: 'Basic',
      children: [
        {
          category: 'datapoint',
          id: 'doc_id',
          label: 'Doc ID',
          type: 'string',
          ui_configuration: { type: 'captured' },
        },
        {
          category: 'datapoint',
          id: 'vendor',
          label: 'Vendor',
          type: 'enum',
          ui_configuration: { type: 'lookup' },
        },
      ],
    },
    {
      category: 'section',
      id: 'items_section',
      label: 'Items',
      children: [
        {
          category: 'multivalue',
          id: 'items',
          label: 'Items',
          children: {
            category: 'tuple',
            id: 'item',
            label: 'Item',
            children: [{ category: 'datapoint', id: 'item_desc', label: 'Desc', type: 'string' }],
          },
        },
      ],
    },
  ];
}

let root: HTMLElement;
const chromeSet = vi.fn(async (_v: any) => {});
vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({})), set: chromeSet } } });
const keyOf = (id: string) => flatten(store.work.value).find((r) => r.node.id === id)!.key;
const row = (id: string) => root.querySelector(`[data-row-key="${keyOf(id)}"]`) as HTMLElement;

// The rule and hook filters are SearchPickers: focus opens the list, mousedown picks.
const openPicker = (picker: string) => {
  act(() => {
    (root.querySelector(`[data-picker="${picker}"] input`) as HTMLInputElement).focus();
  });
};
const pickerOptions = (picker: string) =>
  [...root.querySelectorAll(`[data-picker="${picker}"] [data-option]`)].map((o) => o.textContent);
const pickIn = (picker: string, v: string) => {
  openPicker(picker);
  act(() => {
    root
      .querySelector(`[data-picker="${picker}"] [data-option="${v}"]`)!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
};
const pickerValue = (picker: string) =>
  (root.querySelector(`[data-picker="${picker}"]`) as HTMLElement).dataset.value;
const pickRule = (v: string) => pickIn('rule', v);
const typeFilter = (v: string) => {
  const input = root.querySelector('input[data-filter="fields"]') as HTMLInputElement;
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

// Unmount after each test: a tree left mounted stays subscribed to the store's signals and
// keeps reacting in later tests (61 stale apps once replayed provenance at the same time).
afterEach(() => {
  act(() => {
    render(null, root);
  });
});

beforeEach(() => {
  document.body.innerHTML = '';
  navDrawer.value = false;
  panelWide.value = false;
  root = document.createElement('div');
  document.body.appendChild(root);
  store.workspaces.value = [{ id: 10, url: 'https://x/api/v1/workspaces/10', name: 'AP' }];
  store.queues.value = [
    {
      id: 1,
      name: 'Invoices',
      workspace: 'https://x/api/v1/workspaces/10',
      schema: 'https://x/api/v1/schemas/7',
    },
    {
      id: 2,
      name: 'Invoices US',
      workspace: 'https://x/api/v1/workspaces/10',
      schema: 'https://x/api/v1/schemas/7',
    },
    {
      id: 3,
      name: 'Orders',
      workspace: 'https://x/api/v1/workspaces/10',
      schema: 'https://x/api/v1/schemas/9',
    },
  ];
  store.selectedQueueId.value = 1;
  store.selectedSchemaId.value = 7;
  store.schema.value = {
    id: 7,
    url: 'https://x/api/v1/schemas/7',
    name: 'Invoice schema',
    modified_at: 't0',
    content: content(),
  };
  store.schemas.value = [
    { id: 7, url: 'https://x/api/v1/schemas/7', name: 'Invoice schema' },
    { id: 8, url: 'https://x/api/v1/schemas/8', name: 'Unused schema' },
  ];
  store.startDraft('Invoice schema', withKeys(content()));
  store.selectedKey.value = null;
  store.rowErrors.value = new Map();
  store.annotationId.value = null;
  store.values.value = null;
  store.lineRow.value = {};
  store.validation.value = null;
  store.onlyMessages.value = false;
  store.validationPanel.value = null;
  store.annotationContent.value = [];
  store.revalidateError.value = null;
  store.fieldFilter.value = '';
  store.ruleId.value = null;
  store.ruleEditor.value = null;
  store.hookEditor.value = null;
  store.hooks.value = [
    {
      id: 70,
      name: 'Vendor matching',
      settings: {
        configurations: [
          {
            source: { dataset: 'v', queries: [{ find: { id: '{doc_id}' } }] },
            mapping: { dataset_key: 'id', target_schema_id: 'vendor' },
          },
        ],
      },
    },
  ];
  store.schemaFabry.value = {
    open: false,
    chatId: null,
    busy: false,
    error: null,
    turns: [],
    problems: [],
  };
  store.fabryTouched.value = new Set();
  store.onlyFabryChanges.value = false;
  store.rules.value = [
    {
      id: 40,
      name: 'Doc ID present',
      enabled: true,
      trigger_condition: 'is_empty(field.doc_id) or field.ghost_field',
      actions: [{ type: 'show_message', payload: { schema_id: 'item_desc' } }],
    },
  ];
  act(() => {
    render(<App connected={true} />, root);
  });
});

describe('Builder screen', () => {
  it('renders one row per schema node, with the three flags sharing one column', () => {
    expect(root.querySelectorAll('[data-row-key]').length).toBe(flatten(store.work.value).length);
    const heads = [...root.querySelectorAll('th[data-col]')].map((th) =>
      th.getAttribute('data-col'),
    );
    expect(heads).toEqual([
      'grip',
      'id',
      'label',
      'source',
      'type',
      'flags',
      'rules',
      'matching',
      'actions',
    ]);
    const flags = row('doc_id').querySelector('td[data-col="flags"]')!;
    expect(
      [...flags.querySelectorAll('button[data-col]')].map((e) => e.getAttribute('data-col')),
    ).toEqual(['visible', 'export', 'required']);
    const pressed = (c: string) =>
      flags.querySelector(`button[data-col="${c}"]`)!.getAttribute('aria-pressed');
    expect([pressed('visible'), pressed('export'), pressed('required')]).toEqual([
      'true',
      'true',
      'false',
    ]);
  });

  it('columns have fixed widths except Label, which takes the rest of the row', () => {
    expect(root.querySelector('[data-resize]')).toBeNull();
    const width = (c: string) =>
      (root.querySelector(`col[data-col="${c}"]`) as HTMLElement).style.width;
    expect(width('label')).toBe('');
    expect(width('id')).toBe('200px');
  });

  it('a right panel drops the flags, which the inspector shows', () => {
    const heads = () =>
      [...root.querySelectorAll('th[data-col]')].map((th) => th.getAttribute('data-col'));
    act(() => {
      row('doc_id').click();
    });
    expect(root.querySelector('aside[data-panel="field"]')).not.toBeNull();
    expect(heads()).toEqual([
      'grip',
      'id',
      'label',
      'source',
      'type',
      'rules',
      'matching',
      'actions',
    ]);
    act(() => {
      store.selectedKey.value = null;
    });
    expect(heads()).toContain('flags');
  });

  it('a label edit is one history entry, marks the row edited, and undoes', () => {
    act(() => {
      (row('doc_id').querySelector('[data-col="label"] [data-edit]') as HTMLElement).click();
    });
    const input = row('doc_id').querySelector('[data-col="label"] input') as HTMLInputElement;
    act(() => {
      input.value = 'Document number';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(store.history.value.past.length).toBe(1);
    expect(row('doc_id').dataset.status).toBe('edited');
    expect(row('doc_id').querySelector('[data-col="label"]')!.textContent).toBe('Document number');
    act(() => {
      (root.querySelector('[data-action="undo"]') as HTMLElement).click();
    });
    expect(row('doc_id').querySelector('[data-col="label"]')!.textContent).toBe('Doc ID');
    expect(row('doc_id').dataset.status).toBeUndefined();
  });

  it('deleting a section strikes through its fields, and restore brings them back', () => {
    act(() => {
      (row('items_section').querySelector('[data-action="delete"]') as HTMLElement).click();
    });
    for (const id of ['items_section', 'items', 'item', 'item_desc']) {
      expect(row(id).dataset.deleted).toBe('true');
    }
    act(() => {
      (row('items_section').querySelector('[data-action="restore"]') as HTMLElement).click();
    });
    expect(root.querySelectorAll('[data-deleted="true"]').length).toBe(0);
  });

  it('shows a lookup source as read-only text', () => {
    const cell = row('vendor').querySelector('[data-col="source"]')!;
    expect(cell.querySelector('select')).toBeNull();
    expect(cell.textContent).toBe('lookup');
    expect(row('doc_id').querySelector('[data-col="source"] select')).not.toBeNull();
  });

  it('+ Table adds a table with one row type and one column; + List adds a one-value list', () => {
    const section = keyOf('basic_section');
    const before = root.querySelectorAll('[data-row-key]').length;
    act(() => {
      (
        root.querySelector(`[data-action="add-table"][data-parent="${section}"]`) as HTMLElement
      ).click();
    });
    expect(root.querySelectorAll('[data-row-key]').length).toBe(before + 3);
    act(() => {
      (
        root.querySelector(`[data-action="add-list"][data-parent="${section}"]`) as HTMLElement
      ).click();
    });
    expect(root.querySelectorAll('[data-row-key]').length).toBe(before + 5);
    expect(root.querySelectorAll('[data-status="new"]').length).toBe(5);
    expect(store.history.value.past.length).toBe(2);
  });

  it('+ Add field appends a new row to the section', () => {
    const before = root.querySelectorAll('[data-row-key]').length;
    act(() => {
      (
        root.querySelector(
          `[data-action="add-field"][data-parent="${keyOf('basic_section')}"]`,
        ) as HTMLElement
      ).click();
    });
    expect(root.querySelectorAll('[data-row-key]').length).toBe(before + 1);
    expect(root.querySelectorAll('[data-status="new"]').length).toBe(1);
  });

  it('flipping Visible sets hidden on the field', () => {
    act(() => {
      (row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement).click();
    });
    expect(flatten(store.work.value).find((r) => r.node.id === 'doc_id')!.node.hidden).toBe(true);
  });
});

describe('Builder keyboard and dialog', () => {
  it('⌘Z undoes right after a switch was flipped (focus still on the switch)', () => {
    const input = row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement;
    act(() => {
      input.focus();
      input.click();
    });
    expect(store.history.value.past.length).toBe(1);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    });
    expect(store.history.value.past.length).toBe(0);
  });

  it('the save dialog does not close on an overlay click while saving', () => {
    act(() => {
      (row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement).click();
    });
    act(() => {
      (root.querySelector('[data-action="save"]') as HTMLElement).click();
    });
    store.saving.value = true;
    act(() => {
      (root.querySelector('[role="dialog"]')!.parentElement as HTMLElement).click();
    });
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    store.saving.value = false;
  });
});

describe('Builder annotation values', () => {
  function pick() {
    act(() => {
      store.annotationId.value = 55;
      store.values.value = annotationValues([
        {
          category: 'section',
          schema_id: 'basic_section',
          children: [{ category: 'datapoint', schema_id: 'doc_id', content: { value: 'INV-1' } }],
        },
        {
          category: 'section',
          schema_id: 'items_section',
          children: [
            {
              category: 'multivalue',
              schema_id: 'items',
              children: ['Bolts', 'Nuts'].map((v) => ({
                category: 'tuple',
                schema_id: 'item',
                children: [
                  { category: 'datapoint', schema_id: 'item_desc', content: { value: v } },
                ],
              })),
            },
          ],
        },
      ]);
    });
  }
  const value = (id: string) => row(id).querySelector('td[data-col="value"]')!.textContent;

  it('has no Value column until an annotation is picked', () => {
    expect(root.querySelector('th[data-col="value"]')).toBeNull();
    pick();
    const heads = [...root.querySelectorAll('th[data-col]')].map((th) =>
      th.getAttribute('data-col'),
    );
    expect(heads).toEqual([
      'grip',
      'id',
      'label',
      'source',
      'type',
      'flags',
      'rules',
      'matching',
      'actions',
      'value',
    ]);
  });

  it('shows header values, a row count on the table, and steps through table rows', () => {
    pick();
    expect(value('doc_id')).toBe('INV-1');
    expect(value('vendor')).toBe('—');
    expect(row('items').querySelector('td[data-col="value"]')!.textContent).toContain('2 rows');
    expect(value('item_desc')).toBe('Bolts');
    act(() => {
      (row('items').querySelector('[data-action="next-row"]') as HTMLElement).click();
    });
    expect(value('item_desc')).toBe('Nuts');
  });

  it('puts the value cell last in the row', () => {
    pick();
    const cells = [...row('doc_id').children];
    expect(cells[cells.length - 1].getAttribute('data-col')).toBe('value');
  });

  it('the x button clears the picked annotation', () => {
    pick();
    act(() => {
      (root.querySelector('[data-action="clear-annotation"]') as HTMLElement).click();
    });
    expect(store.annotationId.value).toBeNull();
    expect(root.querySelector('th[data-col="value"]')).toBeNull();
    expect(root.querySelector('[data-action="clear-annotation"]')).toBeNull();
  });
});

const openNav = () =>
  act(() => {
    (root.querySelector('[data-action="open-nav"]') as HTMLElement).click();
  });

describe('Builder left panel', () => {
  beforeEach(openNav);

  it('lists queues with their ids, then schemas no queue uses', () => {
    const queues = [...root.querySelectorAll('[data-queue-id]')].map((e) => e.textContent);
    expect(queues).toEqual(['Invoices (1)', 'Invoices US (2)', 'Orders (3)']);
    const orphans = [...root.querySelectorAll('[data-schema-id]')].map((e) => e.textContent);
    expect(orphans).toEqual(['Unused schema (8)']);
  });

  it('highlights every other queue that shares the open schema', () => {
    const shared = (id: number) =>
      root.querySelector(`[data-queue-id="${id}"]`)!.getAttribute('data-shared');
    expect([shared(1), shared(2), shared(3)]).toEqual([null, 'true', null]);
  });
});

describe('Builder schema rename', () => {
  it('the breadcrumb shows the schema id and its name is a staged, undoable edit', () => {
    const crumb = root.querySelector('[data-action="rename-schema"]')!;
    expect(crumb.parentElement!.textContent).toContain('(7)');
    act(() => {
      (crumb.querySelector('[data-edit]') as HTMLElement).click();
    });
    const input = crumb.querySelector('input') as HTMLInputElement;
    act(() => {
      input.value = 'Invoice schema v2';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(store.draftName.value).toBe('Invoice schema v2');
    expect(root.textContent).toContain('renamed');
    act(() => {
      (root.querySelector('[data-action="undo"]') as HTMLElement).click();
    });
    expect(store.draftName.value).toBe('Invoice schema');
  });
});

describe('Builder left panel actions', () => {
  beforeEach(openNav);

  it('has create buttons for workspaces and queues, and delete buttons', () => {
    expect(root.querySelector('[data-action="new-workspace"]')).not.toBeNull();
    expect(root.querySelector('[data-action="new-queue"]')).not.toBeNull();
    expect(root.querySelector('[data-action="delete-queue"][data-queue="1"]')).not.toBeNull();
    expect(root.querySelector('[data-action="delete-schema"][data-schema="8"]')).not.toBeNull();
  });

  it('+ Queue opens a dialog with the three schema choices', () => {
    act(() => {
      (root.querySelector('[data-action="new-queue"]') as HTMLElement).click();
    });
    const modes = [...root.querySelectorAll('[role="dialog"] input[name="schema-mode"]')].map(
      (e) => (e as HTMLInputElement).value,
    );
    expect(modes).toEqual(['copy', 'share', 'empty']);
  });

  it('+ Schema opens a dialog offering a copy or an empty schema', () => {
    act(() => {
      (root.querySelector('[data-action="new-schema"]') as HTMLElement).click();
    });
    const modes = [...root.querySelectorAll('[role="dialog"] input[name="schema-mode"]')].map(
      (e) => (e as HTMLInputElement).value,
    );
    expect(modes).toEqual(['copy', 'empty']);
  });
});

describe('Builder formula editor', () => {
  function openFormula() {
    act(() => {
      store.startDraft(
        'Invoice schema',
        withKeys([
          {
            category: 'section',
            id: 's',
            label: 'S',
            children: [
              {
                category: 'datapoint',
                id: 'total_check',
                label: 'Check',
                type: 'number',
                ui_configuration: { type: 'formula' },
                formula: 'field.a+field.b',
              },
            ],
          },
        ]),
      );
      store.selectedKey.value = flatten(store.work.value).find(
        (r) => r.node.id === 'total_check',
      )!.key;
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
    const formula = () =>
      flatten(store.work.value).find((r) => r.node.id === 'total_check')!.node.formula;
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

describe('Builder field filter', () => {
  it('typing narrows the grid to matches and their parents, and hides the add links', () => {
    const input = root.querySelector('input[data-filter="fields"]') as HTMLInputElement;
    act(() => {
      input.value = 'desc';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const shown = [...root.querySelectorAll('[data-row-key]')].map(
      (r) =>
        flatten(store.work.value).find((x) => x.key === r.getAttribute('data-row-key'))!.node.id,
    );
    expect(shown).toEqual(['items_section', 'items', 'item', 'item_desc']);
    expect(root.querySelector('[data-action="add-field"]')).toBeNull();
    expect(root.textContent).toContain('1 match');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(store.fieldFilter.value).toBe('');
    expect(root.querySelectorAll('[data-row-key]').length).toBe(flatten(store.work.value).length);
  });
});

describe('Builder queue drawer', () => {
  const nav = () => root.querySelector('nav');

  it('is hidden while a schema is open; ☰ opens it over the grid', () => {
    expect(nav()).toBeNull();
    openNav();
    expect(nav()!.hasAttribute('data-nav-drawer')).toBe(true);
    expect(root.querySelector('[data-queue-id]')).not.toBeNull();
  });

  it('closes on ✕, on a click beside it, and on Esc', () => {
    openNav();
    act(() => {
      (root.querySelector('[data-action="close-nav"]') as HTMLElement).click();
    });
    expect(nav()).toBeNull();
    openNav();
    act(() => {
      (root.querySelector('[data-nav-backdrop]') as HTMLElement).click();
    });
    expect(nav()).toBeNull();
    openNav();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(nav()).toBeNull();
  });

  it('stays in place, with no close button, while nothing is open', () => {
    act(() => {
      store.selectedQueueId.value = null;
      store.selectedSchemaId.value = null;
    });
    expect(nav()!.hasAttribute('data-nav-drawer')).toBe(false);
    expect(root.querySelector('[data-action="close-nav"]')).toBeNull();
    expect(root.querySelector('[data-queue-id]')).not.toBeNull();
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

describe('Builder rule highlight', () => {
  it('picking a rule marks the fields it reads and targets, and lists missing ones', () => {
    pickRule('40');
    expect(row('doc_id').dataset.rule).toBe('condition');
    expect(row('item_desc').dataset.rule).toBe('action');
    expect(row('vendor')).toBeNull(); // filtered out: the rule does not use it
    expect(root.textContent).toContain('ghost_field');
    act(() => {
      (root.querySelector('[data-action="clear-rule"]') as HTMLElement).click();
    });
    expect(row('doc_id').dataset.rule).toBeUndefined();
  });
});

describe('Builder rule mode', () => {
  const content = () => root.querySelector('[data-code="condition"] .cm-content') as HTMLElement;
  const condition = () => store.ruleEditor.value!.draft.trigger_condition;

  it("a field's + opens a new rule in place of the field inspector; the bar has no + Rule", () => {
    expect(root.querySelector('[data-action="new-rule"]')).toBeNull();
    act(() => {
      row('doc_id').click();
    });
    expect(root.querySelector('aside[data-panel="field"]')).not.toBeNull();
    act(() => {
      (row('doc_id').querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe('field.doc_id');
    expect(store.ruleEditor.value!.draft.actions[0].payload.schema_id).toBe('doc_id');
    expect(root.querySelector('aside[data-panel="rule"]')).not.toBeNull();
    expect(root.querySelector('aside[data-panel="field"]')).toBeNull();
  });

  it('picking a rule opens it in the rule editor; the bar has no Edit button', () => {
    pickRule('40');
    expect(store.ruleEditor.value!.ruleId).toBe(40);
    expect(content().textContent).toContain('is_empty(field.doc_id)');
    expect(root.querySelector('[data-action="edit-rule"]')).toBeNull();
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

describe('Builder rules column', () => {
  const cell = (id: string) => row(id).querySelector('td[data-col="rules"]') as HTMLElement;
  const count = (id: string) =>
    cell(id).querySelector('[data-action="field-rules"]')?.textContent ?? '';

  it('counts the rules that use each field; one rule opens straight into the editor', () => {
    expect(count('doc_id')).toBe('1');
    expect(count('item_desc')).toBe('1');
    expect(count('vendor')).toBe('');
    act(() => {
      (cell('doc_id').querySelector('[data-action="field-rules"]') as HTMLElement).click();
    });
    expect(store.ruleEditor.value!.ruleId).toBe(40);
  });

  it('several rules open a list; picking one opens it', () => {
    act(() => {
      store.rules.value = [
        ...store.rules.value,
        { id: 41, name: 'Second', enabled: true, trigger_condition: 'field.doc_id', actions: [] },
      ];
    });
    expect(count('doc_id')).toBe('2');
    act(() => {
      (cell('doc_id').querySelector('[data-action="field-rules"]') as HTMLElement).click();
    });
    const items = [...root.querySelectorAll('[data-rule-option]')].map((e) => e.textContent);
    expect(items).toEqual(['Doc ID present (40)', 'Second (41)']);
    act(() => {
      (root.querySelector('[data-rule-option="41"]') as HTMLElement).click();
    });
    expect(store.ruleEditor.value!.ruleId).toBe(41);
    expect(root.querySelector('[data-rule-option]')).toBeNull();
  });

  it('the list closes on a click anywhere else', () => {
    act(() => {
      store.rules.value = [
        ...store.rules.value,
        { id: 41, name: 'Second', enabled: true, trigger_condition: 'field.doc_id', actions: [] },
      ];
    });
    act(() => {
      (cell('doc_id').querySelector('[data-action="field-rules"]') as HTMLElement).click();
    });
    expect(root.querySelector('[data-rule-option]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(root.querySelector('[data-rule-option]')).toBeNull();
  });
});

describe('Builder rule filter', () => {
  const shown = () =>
    [...root.querySelectorAll('[data-row-key]')].map(
      (r) =>
        flatten(store.work.value).find((x) => x.key === r.getAttribute('data-row-key'))!.node.id,
    );

  it('picking a rule leaves only its fields; text adds matches; ✕ closes and shows all', () => {
    pickRule('40');
    expect(shown()).toEqual([
      'basic_section',
      'doc_id',
      'items_section',
      'items',
      'item',
      'item_desc',
    ]);
    typeFilter('vendor');
    expect(shown()).toContain('vendor');
    expect(shown()).toContain('doc_id');
    typeFilter('');
    act(() => {
      (root.querySelector('[data-action="clear-rule"]') as HTMLElement).click();
    });
    expect(store.ruleEditor.value).toBeNull();
    expect(shown().length).toBe(flatten(store.work.value).length);
  });

  it('the filter bar holds text, rule, hook (and configuration), then the annotation', () => {
    const bar = root.querySelector('input[data-filter="fields"]')!.parentElement!;
    const order = [...bar.querySelectorAll('input[data-filter], [data-picker]')].map(
      (e) => e.getAttribute('data-filter') || e.getAttribute('data-picker'),
    );
    expect(order).toEqual(['fields', 'rule', 'hook', 'annotation']);
    expect(root.querySelector('[data-toolbar] select[data-picker="annotation"]')).toBeNull();
  });
});

describe('Builder rule action icons', () => {
  function openRule(actions: any[], condition = 'field.doc_id') {
    act(() => {
      store.rules.value = [
        { id: 50, name: 'Icons', enabled: true, trigger_condition: condition, actions },
      ];
    });
    pickRule('50');
  }
  const marks = (id: string) =>
    [...row(id).querySelectorAll('[data-mark]')].map((e) => e.getAttribute('data-mark'));

  it('shows an icon per action kind on the field it targets, and "if" for condition reads', () => {
    openRule([
      {
        id: 'a',
        type: 'show_message',
        event: 'validation',
        payload: { type: 'warning', content: 'Check', schema_id: 'doc_id' },
      },
      {
        id: 'b',
        type: 'show_message',
        event: 'validation',
        payload: { type: 'error', content: 'Bad', schema_id: 'item_desc' },
      },
      {
        id: 'c',
        type: 'show_hide_field',
        event: 'validation',
        payload: { schema_ids: ['vendor'] },
      },
      {
        id: 'd',
        type: 'add_automation_blocker',
        event: 'validation',
        payload: { content: 'Stop', schema_id: 'item_desc' },
      },
    ]);
    expect(marks('doc_id')).toEqual(['if', 'warning']);
    // the marks live in the rule column, not next to the field name
    expect(row('doc_id').querySelector('td[data-col="id"] [data-mark]')).toBeNull();
    expect(row('doc_id').querySelector('td[data-col="rule"] [data-mark="warning"]')).not.toBeNull();
    expect(marks('item_desc')).toEqual(['error', 'blocker']);
    expect(marks('vendor')).toEqual(['show_hide']);
    expect(row('doc_id').querySelector('[data-mark="warning"]')!.getAttribute('title')).toContain(
      'Check',
    );
  });

  it('a click on a row in rule mode no longer inserts anything into the rule', () => {
    openRule([
      {
        id: 'a',
        type: 'show_message',
        event: 'validation',
        payload: { type: 'info', content: 'x', schema_id: 'doc_id' },
      },
    ]);
    const before = store.ruleEditor.value!.draft.trigger_condition;
    act(() => {
      row('doc_id').click();
    });
    expect(store.ruleEditor.value!.draft.trigger_condition).toBe(before);
    expect(root.querySelector('[data-insert]')).toBeNull();
  });
});

describe('Builder rule column and whole-document row', () => {
  const heads = () =>
    [...root.querySelectorAll('th[data-col]')].map((th) => th.getAttribute('data-col'));

  it('the rule column appears only while a rule is open, before Value', () => {
    expect(heads()).not.toContain('rule');
    act(() => {
      store.rules.value = [
        {
          id: 60,
          name: 'Global',
          enabled: true,
          trigger_condition: 'field.doc_id',
          actions: [
            {
              id: 'a',
              type: 'add_automation_blocker',
              event: 'validation',
              payload: { content: 'Stop' },
            },
            { id: 'b', type: 'send_email', event: 'annotation_exported', payload: {} },
            { id: 'c', type: 'change_queue', event: 'annotation_confirmed', payload: {} },
          ],
        },
      ];
    });
    pickRule('60');
    expect(heads()).toEqual(['id', 'label', 'source', 'type', 'rules', 'matching', 'rule']);
    const doc = root.querySelector('[data-doc-row]') as HTMLElement;
    expect(doc.textContent).toContain('Whole document');
    expect(
      [...doc.querySelectorAll('[data-mark]')].map((e) => e.getAttribute('data-mark')),
    ).toEqual(['blocker', 'send_email', 'change_queue']);
    act(() => {
      (root.querySelector('[data-action="clear-rule"]') as HTMLElement).click();
    });
    expect(heads()).not.toContain('rule');
    expect(root.querySelector('[data-doc-row]')).toBeNull();
  });
});

describe('Builder grid is read-only in rule mode', () => {
  it('no delete, no flags, disabled selects, no ID editing, no drag; Rules still works', () => {
    pickRule('40');
    const r = row('doc_id');
    expect(r.querySelector('[data-action="delete"]')).toBeNull();
    expect((r.querySelector('td[data-col="type"] select') as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((r.querySelector('td[data-col="source"] select') as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(r.querySelector('button[data-col="visible"]')).toBeNull();
    expect(r.querySelector('[data-edit]')).toBeNull();
    expect(r.querySelector('[draggable="true"]')).toBeNull();
    expect(r.querySelector('[data-action="new-rule-for-field"]')).not.toBeNull();
    act(() => {
      (root.querySelector('[data-action="clear-rule"]') as HTMLElement).click();
    });
    expect(row('doc_id').querySelector('[data-action="delete"]')).not.toBeNull();
    expect(row('doc_id').querySelector('[data-edit]')).not.toBeNull();
  });

  it('⌘Z does not undo a schema change while a rule is open', () => {
    act(() => {
      (row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement).click();
    });
    pickRule('40');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    });
    expect(store.history.value.past.length).toBe(1);
  });
});

describe('Builder rule editor: Mr. Fabry box', () => {
  it('opens prefilled with the field the rule started from', () => {
    act(() => {
      (row('doc_id').querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    const box = root.querySelector('textarea[data-fabry-prompt]') as HTMLTextAreaElement;
    expect(box.value).toContain('doc_id');
    expect(root.querySelector('[data-action="ask-fabry"]')).not.toBeNull();
  });

  it('the condition editor shows a proposal once it fills the draft', () => {
    act(() => {
      (row('doc_id').querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    act(() => {
      store.ruleEditor.value = {
        ...store.ruleEditor.value!,
        draft: { ...store.ruleEditor.value!.draft, trigger_condition: 'is_empty(field.doc_id)' },
      };
      store.assistRev.value++;
    });
    const cm = root.querySelector('[data-code="condition"] .cm-content') as HTMLElement;
    expect(cm.textContent).toBe('is_empty(field.doc_id)');
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
          {
            category: 'section',
            id: 's',
            label: 'S',
            children: [
              {
                category: 'datapoint',
                id: 'f',
                label: 'F',
                type: 'number',
                ui_configuration: { type: 'formula' },
                formula: '1',
              },
            ],
          },
        ]),
      );
      store.selectedKey.value = flatten(store.work.value).find((r) => r.node.id === 'f')!.key;
    });
    act(() => {
      (root.querySelector('[data-action="expand-formula"]') as HTMLElement).click();
    });
    expect(
      root.querySelector('aside[data-expanded="true"] textarea[data-fabry-prompt]'),
    ).not.toBeNull();
  });
});

describe('Builder schema-wide Mr. Fabry', () => {
  it('the toolbar button opens the Mr. Fabry panel; "only changes" narrows the grid', () => {
    act(() => {
      (root.querySelector('[data-action="open-schema-fabry"]') as HTMLElement).click();
    });
    expect(root.querySelector('aside[data-panel="schema-fabry"]')).not.toBeNull();
    act(() => {
      apply(setAttr(store.work.value, keyOf('item_desc'), ['label'], 'Described'));
      store.fabryTouched.value = new Set([keyOf('item_desc'), keyOf('doc_id')]); // doc_id unchanged
    });
    act(() => {
      (root.querySelector('input[data-action="only-fabry"]') as HTMLInputElement).click();
    });
    const shown = [...root.querySelectorAll('[data-row-key]')].map(
      (r) =>
        flatten(store.work.value).find((x) => x.key === r.getAttribute('data-row-key'))!.node.id,
    );
    expect(shown).toEqual(['items_section', 'items', 'item', 'item_desc']);
  });
});

describe('Ask box', () => {
  it('empties after a message is sent', () => {
    act(() => {
      (root.querySelector('[data-action="open-schema-fabry"]') as HTMLElement).click();
    });
    const box = root.querySelector('textarea[data-fabry-prompt]') as HTMLTextAreaElement;
    act(() => {
      box.value = 'Add a VAT section';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      (root.querySelector('[data-action="ask-fabry"]') as HTMLElement).click();
    });
    expect((root.querySelector('textarea[data-fabry-prompt]') as HTMLTextAreaElement).value).toBe(
      '',
    );
    expect(store.schemaFabry.value.turns[0]).toEqual({ role: 'you', text: 'Add a VAT section' });
  });

  it('Enter sends; Shift+Enter does not', () => {
    act(() => {
      (root.querySelector('[data-action="open-schema-fabry"]') as HTMLElement).click();
    });
    const box = () => root.querySelector('textarea[data-fabry-prompt]') as HTMLTextAreaElement;
    act(() => {
      box().value = 'line one';
      box().dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      box().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(store.schemaFabry.value.turns).toEqual([]);
    act(() => {
      box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(store.schemaFabry.value.turns[0]).toEqual({ role: 'you', text: 'line one' });
    expect(box().value).toBe('');
  });
});

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
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(
      root.querySelector('[data-code="hook"] .cm-editor') as HTMLElement,
    )!;
    const text = view.state.doc.toString();
    const head = view.state.selection.main.head;
    expect(text[head]).toBe('{');
    expect(text.slice(head, head + 20)).toContain('"name": "B"');
    expect(root.querySelector('[data-code="hook"] .cm-flash')).not.toBeNull();
    // the flash fades out: an animation from the highlight color to transparent
    const css = [
      ...[...document.querySelectorAll('style')].map((el) => el.textContent || ''),
      ...((document as any).adoptedStyleSheets || []).flatMap((sh: CSSStyleSheet) =>
        [...sh.cssRules].map((r) => r.cssText),
      ),
    ].join('\n');
    expect(css).toMatch(/@keyframes builder-cm-flash/);
    expect(css).toMatch(/cm-flash[^}]*animation[^}]*builder-cm-flash/);
  });
});

describe('Builder searchable rule picker', () => {
  beforeEach(() => {
    act(() => {
      store.rules.value = [
        { id: 40, name: 'Doc ID present', enabled: true, trigger_condition: '', actions: [] },
        { id: 41, name: 'Totals match', enabled: true, trigger_condition: '', actions: [] },
      ];
    });
  });
  const input = () => root.querySelector('[data-picker="rule"] input') as HTMLInputElement;
  const type = (v: string) =>
    act(() => {
      input().value = v;
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const key = (k: string) =>
    act(() => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });

  it('typing narrows the list by name or by id', () => {
    openPicker('rule');
    type('total');
    expect(pickerOptions('rule')).toEqual(['Totals match (41)']);
    type('40');
    expect(pickerOptions('rule')).toEqual(['Doc ID present (40)']);
    type('nothing like it');
    expect(pickerOptions('rule')).toEqual([]);
    expect(root.querySelector('[data-picker="rule"]')!.textContent).toContain('No match');
  });

  it('arrow keys move through the matches and Enter opens the rule', () => {
    openPicker('rule');
    key('ArrowDown');
    key('Enter');
    expect(store.ruleEditor.value!.ruleId).toBe(41);
    expect(input().value).toBe('Totals match (41)');
    expect(root.querySelector('[data-picker="rule"] [role="listbox"]')).toBeNull();
  });

  it('Esc closes the list and keeps the picked rule', () => {
    pickRule('40');
    openPicker('rule');
    type('tot');
    key('Escape');
    expect(root.querySelector('[data-picker="rule"] [role="listbox"]')).toBeNull();
    expect(input().value).toBe('Doc ID present (40)');
    expect(store.ruleEditor.value!.ruleId).toBe(40);
  });
});

describe('Builder wide panel', () => {
  const heads = () =>
    [...root.querySelectorAll('th[data-col]')].map((th) => th.getAttribute('data-col'));
  const wide = () => root.querySelector('[data-action="panel-wide"]') as HTMLElement;

  it('widens the hook panel, leaving ID and the MDH column; remembered; narrows back', () => {
    pickIn('hook', '70');
    act(() => wide().click());
    expect(heads()).toEqual(['id', 'mdh']);
    expect(wide().getAttribute('aria-pressed')).toBe('true');
    expect(chromeSet).toHaveBeenCalledWith({ builderPanelWide: true });
    act(() => wide().click());
    expect(heads()).toContain('label');
  });

  it('a field panel leaves ID and Label; closing the panel brings every column back', () => {
    act(() => {
      row('doc_id').click();
    });
    act(() => wide().click());
    expect(heads()).toEqual(['id', 'label']);
    act(() => {
      store.selectedKey.value = null;
    });
    expect(heads()).toContain('flags');
  });
});

describe('Builder cut-off cells', () => {
  const hover = (td: HTMLElement, cut: boolean) => {
    Object.defineProperty(td, 'scrollWidth', { value: cut ? 300 : 100, configurable: true });
    Object.defineProperty(td, 'clientWidth', { value: 100, configurable: true });
    act(() => {
      td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
  };
  const tip = () => root.querySelector('[data-cell-tip]');

  it('hovering a cut-off ID or label shows both in full at once', () => {
    const id = row('doc_id').querySelector('td[data-col="id"]') as HTMLElement;
    const label = row('doc_id').querySelector('td[data-col="label"]') as HTMLElement;
    hover(label, true);
    expect(tip()!.textContent).toBe(`doc_id · ${label.textContent}`);
    expect(id.dataset.full).toBe(label.dataset.full);
  });

  it('shows nothing over a cell that fits, and hides when the mouse leaves the grid', () => {
    const label = row('doc_id').querySelector('td[data-col="label"]') as HTMLElement;
    hover(label, false);
    expect(tip()).toBeNull();
    hover(label, true);
    act(() => {
      root.querySelector('table')!.dispatchEvent(new MouseEvent('mouseleave'));
    });
    expect(tip()).toBeNull();
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
      store.validationPanel.value = 'rules';
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
    const others = [...panel().querySelectorAll('[data-other-message]')].map((e) => e.textContent);
    expect(
      others.some(
        (t) => t!.includes('item_desc') && t!.includes('row 2') && t!.includes('required'),
      ),
    ).toBe(true);
    expect(others.some((t) => t!.includes('Duplicate document'))).toBe(true);
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
    expect(store.validationPanel.value).toBe('provenance');
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
