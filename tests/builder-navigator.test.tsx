// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import * as store from '../src/builder/store.js';
import CreateDialog from '../src/builder/components/CreateDialog.jsx';
import { setupBuilderScreen, root, chromeSet, openNav } from './support/builderScreen.jsx';

setupBuilderScreen();

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

  it('a queue delete offers Delete in 24 h and Delete now, with Cancel focused', async () => {
    const fetchMock = vi.fn(async (_url: string, _opts: any) => ({
      ok: true,
      status: 204,
      headers: new Headers(),
      json: async () => ({ results: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const open = () =>
      act(() => {
        (root.querySelector('[data-action="delete-queue"][data-queue="3"]') as HTMLElement).click();
      });
    open();
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Orders (3)');
    expect(dialog.textContent).toContain('cannot be deleted while the queue still exists');
    expect(document.activeElement?.textContent).toBe('Cancel');
    for (const [action, url] of [
      ['delete-later', '/api/v1/queues/3'],
      ['delete-now', '/api/v1/queues/3?delete_after=0'],
    ]) {
      fetchMock.mockClear();
      if (!root.querySelector('[role="dialog"]')) open();
      await act(async () => {
        (root.querySelector(`[data-action="${action}"]`) as HTMLElement).click();
      });
      expect(root.querySelector('[role="dialog"]')).toBeNull();
      expect(fetchMock.mock.calls[0][0]).toBe(url);
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    }
    vi.unstubAllGlobals();
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set: chromeSet } },
    });
  });

  it('a queue Rossum is deleting is marked Deleting and has no delete button', () => {
    act(() => {
      store.queues.value = store.queues.value.map((q) =>
        q.id === 3 ? { ...q, status: 'deletion_requested' } : q,
      );
    });
    expect(root.querySelector('[data-deleting="3"]')?.textContent).toBe('Deleting');
    expect(root.querySelector('[data-action="delete-queue"][data-queue="3"]')).toBeNull();
    expect(root.querySelector('[data-action="delete-queue"][data-queue="1"]')).not.toBeNull();
  });

  it('a deleted schema shows Undo until it is restored', () => {
    act(() => {
      (root.querySelector('[data-action="delete-schema"][data-schema="8"]') as HTMLElement).click();
    });
    expect(root.querySelector('[role="dialog"]')!.textContent).toContain('new ID');
    act(() => {
      store.deletedSchema.value = { name: 'Unused schema', content: [] };
    });
    const line = root.querySelector('[data-deleted-schema]')!;
    expect(line.textContent).toContain('Schema Unused schema deleted.');
    expect(line.textContent).toContain('new ID');
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

describe('Builder create dialog', () => {
  it('focuses the name once; a click on a radio keeps the focus there', async () => {
    store.schema.value = { id: 7, name: 'Inv', url: 'https://x/api/v1/schemas/7', content: [] };
    act(() => {
      render(<CreateDialog target={{ kind: 'schema' }} />, root);
    });
    expect(document.activeElement).toBe(root.querySelector('input:not([type])'));
    const empty = root.querySelector('input[value="empty"]') as HTMLInputElement;
    act(() => {
      empty.focus();
      empty.click();
    });
    expect(empty.checked).toBe(true);
    expect(document.activeElement).toBe(empty);
  });
});
