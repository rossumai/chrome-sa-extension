// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/builder/components/App.jsx';
import * as store from '../src/builder/store.js';
import { withKeys, flatten } from '../src/builder/model.js';
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

describe('Builder left panel', () => {
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

describe('Builder panel width', () => {
  it('dragging the panel edge resizes it and remembers the width', () => {
    const nav = root.querySelector('nav') as HTMLElement;
    const before = parseInt(nav.style.width, 10);
    const handle = root.querySelector('[data-resize="nav"]') as HTMLElement;
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 280 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 280 }));
    });
    expect(parseInt(nav.style.width, 10)).toBe(before + 80);
    expect(chromeSet).toHaveBeenCalledWith({ builderNavWidth: before + 80 });
  });

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
