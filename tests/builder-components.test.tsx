// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/builder/components/App.jsx';
import * as store from '../src/builder/store.js';
import { withKeys, flatten } from '../src/builder/model.js';
import { initHistory } from '../src/builder/history.js';

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
  act(() => {
    render(<App connected={true} />, root);
  });
});

describe('Builder screen', () => {
  it('renders one row per schema node with the seven columns in order', () => {
    expect(root.querySelectorAll('[data-row-key]').length).toBe(flatten(store.work.value).length);
    const heads = [...root.querySelectorAll('th[data-col]')].map((th) => th.textContent);
    expect(heads).toEqual(['ID', 'Label', 'Type', 'Source', 'Required', 'Visible', 'Export']);
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
