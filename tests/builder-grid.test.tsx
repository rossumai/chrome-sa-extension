// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'preact/test-utils';
import * as store from '../src/builder/store.js';
import { flatten, setAttr } from '../src/builder/model.js';
import { annotationValues } from '../src/builder/values.js';
import { apply } from '../src/builder/index.jsx';
import { rowOf } from './support/builder.js';
import {
  setupBuilderScreen,
  root,
  chromeSet,
  rowKey,
  row,
  pickIn,
  FIELD_FILTER,
  pickRule,
  typeFilter,
} from './support/builderScreen.jsx';

setupBuilderScreen();

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
      'hooks',
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

  it('columns cannot be resized by hand', () => {
    expect(root.querySelector('[data-resize]')).toBeNull();
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
    const section = rowKey('basic_section');
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
          `[data-action="add-field"][data-parent="${rowKey('basic_section')}"]`,
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
    expect(rowOf(store.work.value, 'doc_id').node.hidden).toBe(true);
  });
});

describe('Builder keyboard and dialog', () => {
  it('⌘Z undoes right after a switch was flipped (focus still on the switch); ⇧⌘Z redoes', () => {
    const input = row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement;
    const key = (shiftKey: boolean) =>
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey, bubbles: true }),
        );
      });
    act(() => {
      input.focus();
      input.click();
    });
    const flipped = store.work.value;
    expect(store.history.value.past.length).toBe(1);
    key(false);
    expect(store.history.value.past.length).toBe(0);
    key(true);
    expect(store.history.value.past.length).toBe(1);
    expect(store.work.value).toBe(flipped);
  });

  it('Escape closes the save dialog and leaves the right panel under it open', () => {
    act(() => {
      (row('doc_id').querySelector('button[data-col="visible"]') as HTMLButtonElement).click();
    });
    act(() => {
      store.rightPanel.value = { kind: 'fabry' };
    });
    act(() => {
      (root.querySelector('[data-action="save"]') as HTMLElement).click();
    });
    const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Save schema');
    expect(document.activeElement).toBe(dialog);
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(store.rightPanel.value).toEqual({ kind: 'fabry' });
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

  it('rule mode: "Rule config", and the rule evaluated once, in the whole document row', () => {
    pick();
    pickRule('40'); // is_empty(field.doc_id) or field.ghost_field
    const head = (c: string) => root.querySelector(`th[data-col="${c}"]`)?.textContent;
    expect(head('rule')).toBe('Rule config');
    expect(root.querySelector('td[data-col="eval"], th[data-col="eval"]')).toBeNull();
    const doc = () => root.querySelector('[data-doc-row] [data-rule-eval]')!.textContent;
    act(() => {
      store.ruleEval.value = { values: [true], errors: [], busy: false, error: null };
    });
    expect(doc()).toBe('Rule eval true');
    act(() => {
      store.ruleEval.value = { values: [false, true], errors: [], busy: false, error: null };
    });
    expect(doc()).toBe('Rule eval true on line 2 of 2');
    act(() => {
      store.ruleEval.value = {
        values: [],
        errors: ['Trigger condition: bad'],
        busy: false,
        error: null,
      };
    });
    expect(doc()).toBe('Rule eval error');
    expect(root.querySelector('[data-rule-eval-error]')!.textContent).toContain(
      'Trigger condition: bad',
    );
  });

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
      'hooks',
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

  it('one field filters the recent annotations and opens a pasted ID or URL', () => {
    act(() => {
      store.annotations.value = [
        { id: 7, label: 'invoice-7.pdf (7)' },
        { id: 8, label: 'credit-8.pdf (8)' },
      ];
    });
    const input = root.querySelector('[data-picker="annotation"] input') as HTMLInputElement;
    const type = (v: string) =>
      act(() => {
        input.focus();
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const listed = () => [...root.querySelectorAll('[data-picker="annotation"] [role="option"]')];
    type('credit');
    expect(listed().map((o) => o.textContent)).toEqual(['credit-8.pdf (8)']);
    type('https://x.rossum.app/document/123');
    expect(listed().map((o) => o.textContent)).toEqual(['Open annotation 123']);
    type('8');
    expect(listed().map((o) => o.textContent)).toEqual(['credit-8.pdf (8)']);
    type('https://x.rossum.app/document/123');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(store.annotationId.value).toBe(123);
    expect(input.value).toBe('annotation (123)');
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

describe('Builder field filter', () => {
  it('typing narrows the grid to matches and their parents, and hides the add links', () => {
    const input = root.querySelector(FIELD_FILTER) as HTMLInputElement;
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

  it('the clear button empties the filter', () => {
    typeFilter('desc');
    act(() => (root.querySelector('button[aria-label="Clear filter"]') as HTMLElement).click());
    expect(store.fieldFilter.value).toBe('');
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

describe('Builder hidden captured fields', () => {
  const mark = (id: string) => row(id).querySelector('[data-warn="hidden-captured"]');

  it('marks a captured field that is hidden, and the field panel can make it visible', () => {
    act(() => {
      apply(setAttr(store.work.value, rowKey('doc_id'), ['hidden'], true));
    });
    expect(mark('doc_id')).not.toBeNull();
    act(() => {
      row('doc_id').click();
    });
    act(() => {
      (root.querySelector('[data-action="show-field"]') as HTMLElement).click();
    });
    expect(mark('doc_id')).toBeNull();
  });

  it('the ! button next to the find box shows only fields with a warning', () => {
    const btn = () => root.querySelector('[data-action="only-warnings"]') as HTMLElement | null;
    expect(btn()).toBeNull(); // nothing to warn about
    act(() => {
      apply(setAttr(store.work.value, rowKey('doc_id'), ['hidden'], true));
    });
    expect(btn()!.textContent).toBe('!1');
    act(() => btn()!.click());
    expect(row('doc_id')).not.toBeNull();
    expect(row('vendor')).toBeNull();
    expect(row('basic_section')).not.toBeNull(); // its section stays, as the path to it
    act(() => btn()!.click());
    expect(row('vendor')).not.toBeNull();
  });

  it('a hidden field with another source is not marked', () => {
    act(() => {
      apply(setAttr(store.work.value, rowKey('vendor'), ['hidden'], true)); // a lookup
    });
    expect(mark('vendor')).toBeNull();
  });
});
