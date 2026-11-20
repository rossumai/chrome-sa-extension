// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render } from 'preact';
import RecordCard from '../src/mdh/components/RecordCard.jsx';
import { selectionMode } from '../src/mdh/store.js';
import jt from '../src/ui/JsonTree.module.css';
import pnl from '../src/mdh/components/panel.module.css';
import jv from '../src/mdh/components/jsonValues.module.css';

function mount(props: any) {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <RecordCard
      record={{ _id: '1', name: 'ACME' }}
      index={0}
      expanded
      onToggle={() => {}}
      onCopy={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      sortState={{}}
      filterState={{}}
      onSort={() => {}}
      onFilter={() => {}}
      charBudget={80}
      indexes={[]}
      {...props}
    />,
    root,
  );
  return root;
}

beforeEach(() => {
  selectionMode.value = false;
});

describe('RecordCard readOnly', () => {
  it('default (not readOnly) shows Edit and Del actions', () => {
    const root = mount({});
    expect(root.querySelector(`.${pnl.actionEdit}`)).not.toBeNull();
    expect(root.querySelector(`.${pnl.actionDelete}`)).not.toBeNull();
    expect(root.querySelector(`.${pnl.actionCopy}`)).not.toBeNull();
  });

  it('readOnly hides Edit/Del but keeps Copy and renders the JSON body', () => {
    const root = mount({ readOnly: true });
    expect(root.querySelector(`.${pnl.actionEdit}`)).toBeNull();
    expect(root.querySelector(`.${pnl.actionDelete}`)).toBeNull();
    expect(root.querySelector(`.${pnl.actionCopy}`)).not.toBeNull();
    // Expanded body renders the JsonTree.
    expect(root.querySelector('.' + jt.root)).not.toBeNull();
  });

  it('readOnly renders JSON keys/values as non-interactive text (no sort/filter)', () => {
    const root = mount({ readOnly: true });
    // Keys are static spans, not clickable buttons.
    expect(root.querySelector(`.${jv.jsonTreeKeyStatic}`)).not.toBeNull();
    expect(root.querySelector(`button.${jv.jsonTreeKey}`)).toBeNull();
    // Values are not clickable (no sort/filter); copy buttons remain.
    expect(root.querySelector(`.${jv.jsonTreeValueClickable}`)).toBeNull();
    expect(root.querySelector(`.${jv.jsonTreeCopyBtn}`)).not.toBeNull();
  });

  it('default (interactive) renders JSON keys/values as clickable buttons', () => {
    const root = mount({}); // not readOnly
    expect(root.querySelector(`button.${jv.jsonTreeKey}`)).not.toBeNull();
    expect(root.querySelector(`button.${jv.jsonTreeValueClickable}`)).not.toBeNull();
    expect(root.querySelector(`.${jv.jsonTreeKeyStatic}`)).toBeNull();
  });

  it('readOnly suppresses the selection checkbox even in selection mode', () => {
    selectionMode.value = true;
    const root = mount({ readOnly: true });
    expect(root.querySelector(`.${jv.recordCheckbox}`)).toBeNull();
    expect(root.querySelector(`.${pnl.actionEdit}`)).toBeNull();
  });
});
