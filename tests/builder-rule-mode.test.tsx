// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'preact/test-utils';
import * as store from '../src/builder/store.js';
import { flatten } from '../src/builder/model.js';
import {
  setupBuilderScreen,
  root,
  row,
  openPicker,
  pickerOptions,
  FIELD_FILTER,
  pickRule,
  typeFilter,
} from './support/builderScreen.jsx';

setupBuilderScreen();

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
    const bar = root.querySelector(FIELD_FILTER)!.parentElement!.parentElement!; // input, its wrap, the bar
    const order = [...bar.querySelectorAll(`${FIELD_FILTER}, [data-picker]`)].map(
      (e) => e.getAttribute('data-picker') ?? 'fields',
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
    expect(heads()).toEqual(['id', 'label', 'source', 'type', 'rules', 'rule']); // Matching makes room
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

  it('shows a gerund while busy and the reply as Markdown', () => {
    act(() => {
      (row('doc_id').querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    act(() => {
      store.assist.value = { ...store.IDLE_ASSIST, busy: true };
    });
    expect(root.querySelector('[data-panel="rule"]')!.textContent).toContain('Thinking…');
    act(() => {
      store.assist.value = { ...store.IDLE_ASSIST, chatId: 'c', reply: 'Use **this** rule.' };
    });
    expect(root.querySelector('[data-panel="rule"] details strong')!.textContent).toBe('this');
  });

  it('the condition editor shows a proposal once it fills the draft', () => {
    act(() => {
      (row('doc_id').querySelector('[data-action="new-rule-for-field"]') as HTMLElement).click();
    });
    act(() => {
      store.rightPanel.value = {
        kind: 'rule',
        editor: {
          ...store.ruleEditor.value!,
          draft: { ...store.ruleEditor.value!.draft, trigger_condition: 'is_empty(field.doc_id)' },
        },
      };
      store.assistRev.value++;
    });
    const cm = root.querySelector('[data-code="condition"] .cm-content') as HTMLElement;
    expect(cm.textContent).toBe('is_empty(field.doc_id)');
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
