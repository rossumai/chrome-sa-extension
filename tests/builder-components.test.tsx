// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/builder/components/App.jsx';
import * as store from '../src/builder/store.js';
import { withKeys, flatten } from '../src/builder/model.js';
import { initHistory } from '../src/builder/history.js';
import { annotationValues } from '../src/builder/values.js';

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

beforeEach(() => {
  document.body.innerHTML = '';
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
  ];
  store.selectedQueueId.value = 1;
  store.schema.value = { id: 7, modified_at: 't0', content: content() };
  const keyed = withKeys(content());
  store.base.value = keyed;
  store.history.value = initHistory(keyed);
  store.selectedKey.value = null;
  store.rowErrors.value = new Map();
  store.annotationId.value = null;
  store.values.value = null;
  store.lineRow.value = {};
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
    expect(heads).toEqual(['id', 'label', 'source', 'type', 'flags']);
    const flags = row('doc_id').querySelector('td[data-col="flags"]')!;
    expect(
      [...flags.querySelectorAll('[data-col]')].map((e) => e.getAttribute('data-col')),
    ).toEqual(['required', 'visible', 'export']);
  });

  it('dragging a header edge resizes that column and remembers the width', () => {
    const col = () => root.querySelector('col[data-col="label"]') as HTMLElement;
    const before = parseInt(col().style.width, 10);
    const handle = root.querySelector('th[data-col="label"] [data-resize]') as HTMLElement;
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 160 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 160 }));
    });
    expect(parseInt(col().style.width, 10)).toBe(before + 60);
    expect(chromeSet).toHaveBeenCalledWith({
      builderColumnWidths: expect.objectContaining({ label: before + 60 }),
    });
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
      (row('doc_id').querySelector('[data-col="visible"] input') as HTMLInputElement).click();
    });
    expect(flatten(store.work.value).find((r) => r.node.id === 'doc_id')!.node.hidden).toBe(true);
  });
});

describe('Builder keyboard and dialog', () => {
  it('⌘Z undoes right after a switch was flipped (focus still on the switch)', () => {
    const input = row('doc_id').querySelector('[data-col="visible"] input') as HTMLInputElement;
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
      (row('doc_id').querySelector('[data-col="visible"] input') as HTMLInputElement).click();
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
    expect(heads).toEqual(['id', 'label', 'source', 'type', 'flags', 'value']);
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
