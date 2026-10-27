// The mounted Builder screen the component tests share: queue 1 open on schema 7 (a header
// section and a line-item table), three queues, one MDH hook and one rule.
import { beforeEach, afterEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../../src/builder/components/App.jsx';
import { modalContent } from '../../src/ui/Modal.jsx';
import * as store from '../../src/builder/store.js';
import { withKeys } from '../../src/builder/model.js';
import { navDrawer, panelWide } from '../../src/builder/components/panels.js';
import { resetBuilderStore, section, dp, keyOf } from './builder.js';

function content(): any[] {
  return [
    section(
      'basic_section',
      [
        dp('doc_id', { label: 'Doc ID', ui_configuration: { type: 'captured' } }),
        dp('vendor', { label: 'Vendor', type: 'enum', ui_configuration: { type: 'lookup' } }),
      ],
      { label: 'Basic' },
    ),
    section(
      'items_section',
      [
        {
          category: 'multivalue',
          id: 'items',
          label: 'Items',
          children: {
            category: 'tuple',
            id: 'item',
            label: 'Item',
            children: [dp('item_desc', { label: 'Desc' })],
          },
        },
      ],
      { label: 'Items' },
    ),
  ];
}

export let root: HTMLElement;
export const chromeSet = vi.fn(async (_v: any) => {});
vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({})), set: chromeSet } } });
export const rowKey = (id: string) => keyOf(store.work.value, id);
export const row = (id: string) =>
  root.querySelector(`[data-row-key="${rowKey(id)}"]`) as HTMLElement;

// The rule and hook filters are SearchPickers: focus opens the list, mousedown picks.
export const openPicker = (picker: string) => {
  act(() => {
    (root.querySelector(`[data-picker="${picker}"] input`) as HTMLInputElement).focus();
  });
};
export const pickerOptions = (picker: string) =>
  [...root.querySelectorAll(`[data-picker="${picker}"] [data-option]`)].map((o) => o.textContent);
export const pickIn = (picker: string, v: string) => {
  openPicker(picker);
  act(() => {
    root
      .querySelector(`[data-picker="${picker}"] [data-option="${v}"]`)!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
};
export const FIELD_FILTER = 'input[aria-label="Find field by ID or label"]';
export const pickerValue = (picker: string) =>
  (root.querySelector(`[data-picker="${picker}"]`) as HTMLElement).dataset.value;
export const pickRule = (v: string) => pickIn('rule', v);
export const typeFilter = (v: string) => {
  const input = root.querySelector(FIELD_FILTER) as HTMLInputElement;
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
export const openNav = () =>
  act(() => {
    (root.querySelector('[data-action="open-nav"]') as HTMLElement).click();
  });

/** Mount the screen before each test of the calling file, and unmount it after. */
export function setupBuilderScreen() {
  // Unmount after each test: a tree left mounted stays subscribed to the store's signals and
  // keeps reacting in later tests (61 stale apps once replayed provenance at the same time).
  afterEach(() => {
    act(() => {
      render(null, root);
    });
  });

  beforeEach(() => {
    resetBuilderStore();
    modalContent.value = null;
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
}
