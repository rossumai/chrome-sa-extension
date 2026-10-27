// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'preact/test-utils';
import * as store from '../src/builder/store.js';
import { flatten, setAttr } from '../src/builder/model.js';
import { apply } from '../src/builder/index.jsx';
import { setupBuilderScreen, root, rowKey } from './support/builderScreen.jsx';

setupBuilderScreen();

describe('Builder schema-wide Mr. Fabry', () => {
  it('the toolbar button opens the Mr. Fabry panel; "only changes" narrows the grid', () => {
    act(() => {
      (root.querySelector('[data-action="open-schema-fabry"]') as HTMLElement).click();
    });
    expect(root.querySelector('aside[data-panel="schema-fabry"]')).not.toBeNull();
    act(() => {
      apply(setAttr(store.work.value, rowKey('item_desc'), ['label'], 'Described'));
      store.fabryTouched.value = new Set([rowKey('item_desc'), rowKey('doc_id')]); // doc_id unchanged
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
