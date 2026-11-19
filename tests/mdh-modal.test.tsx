// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render, Fragment } from 'preact';

// store.js imports chrome during module init via other MDH modules that may
// be transitively reached; guard with a minimal mock.
globalThis.chrome = globalThis.chrome || {
  storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  runtime: { onMessage: { addListener: () => {} } },
};

import { readFileSync } from 'fs';
import Modal, {
  openModal,
  closeModal,
  confirmModal,
  promptModal,
} from '../src/mdh/components/Modal.jsx';
import mstyles from '../src/ui/Modal.module.css';
import { modalContent } from '../src/mdh/store.js';
import { ModalBody, ModalActions, ModalField } from '../src/ui/Modal.jsx';
import ctl from '../src/ui/controls.module.css';

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<Modal />, root);
  return root;
}

function rerender(root: any) {
  render(<Modal />, root);
}

describe('openModal / closeModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    modalContent.value = null;
  });

  it('openModal sets store value with title and render fn', () => {
    const rfn = () => <div class="my-body">hi</div>;
    openModal('Hello', rfn);
    expect(modalContent.value).toEqual({ title: 'Hello', render: rfn });
  });

  it('closeModal clears the store value', () => {
    openModal('X', () => null);
    expect(modalContent.value).not.toBeNull();
    closeModal();
    expect(modalContent.value).toBeNull();
  });
});

describe('Modal component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    modalContent.value = null;
  });

  it('renders nothing when modalContent is null', () => {
    const root = mount();
    expect(root.querySelector('.' + mstyles.overlay)).toBeNull();
  });

  it('renders title and body when a modal is open', () => {
    const root = mount();
    openModal('My Modal', () => <div class="modal-body">body-text</div>);
    rerender(root);

    expect(root.querySelector('.' + mstyles.title)!.textContent).toBe('My Modal');
    expect(root.querySelector('.modal-body')!.textContent).toBe('body-text');
  });

  it('close button clears the modal', () => {
    const root = mount();
    openModal('Close Me', () => <div />);
    rerender(root);

    root.querySelector<HTMLElement>('.' + mstyles.close)!.click();
    expect(modalContent.value).toBeNull();
  });

  it('clicking the overlay (outside the card) closes the modal', () => {
    const root = mount();
    openModal('Overlay', () => <div />);
    rerender(root);

    const overlay = root.querySelector('.' + mstyles.overlay);
    overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modalContent.value).toBeNull();
  });

  it('clicking inside the card does NOT close the modal', () => {
    const root = mount();
    openModal('Safe', () => <div class="inner">inside</div>);
    rerender(root);

    root.querySelector('.inner')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modalContent.value).not.toBeNull();
  });

  it('Escape key closes the modal', () => {
    const root = mount();
    openModal('Esc', () => <div />);
    rerender(root);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modalContent.value).toBeNull();
  });

  it('non-Escape keys do not close the modal', () => {
    const root = mount();
    openModal('Keep', () => <div />);
    rerender(root);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(modalContent.value).not.toBeNull();
  });

  it('marks the card as a labelled modal dialog', () => {
    const root = mount();
    openModal('My Modal', () => <div />);
    rerender(root);

    const card = root.querySelector('.' + mstyles.card)!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-labelledby')).toBe('modal-title');
    expect(root.querySelector('#modal-title')!.textContent).toBe('My Modal');
  });

  it('close button has an accessible name', () => {
    const root = mount();
    openModal('X', () => <div />);
    rerender(root);
    expect(root.querySelector('.' + mstyles.close)!.getAttribute('aria-label')).toBe('Close');
  });

  it('restores focus to the previously-focused element on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const root = mount();
    openModal('Focus', () => <div />);
    rerender(root);

    closeModal();
    rerender(root);

    expect(document.activeElement).toBe(trigger);
  });
});

describe('confirmModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    modalContent.value = null;
  });

  it('renders the message and confirm/cancel buttons', () => {
    const root = mount();
    confirmModal('Delete?', 'Are you sure?', () => {});
    rerender(root);

    expect(root.querySelector('.' + mstyles.title)!.textContent).toBe('Delete?');
    expect(root.querySelector('.' + mstyles.message)!.textContent).toBe('Are you sure?');
    const btns = root.querySelectorAll('.' + mstyles.actions + ' button');
    expect(btns).toHaveLength(2);
    expect(btns[0].textContent).toBe('Cancel');
    expect(btns[1].textContent).toBe('Confirm');
  });

  it('Cancel closes without invoking the callback', () => {
    const root = mount();
    const spy = vi.fn();
    confirmModal('T', 'M', spy);
    rerender(root);

    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[0].click();
    expect(spy).not.toHaveBeenCalled();
    expect(modalContent.value).toBeNull();
  });

  it('Confirm closes and invokes the callback', () => {
    const root = mount();
    const spy = vi.fn();
    confirmModal('T', 'M', spy);
    rerender(root);

    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[1].click();
    expect(spy).toHaveBeenCalledOnce();
    expect(modalContent.value).toBeNull();
  });

  it('returns a Promise that resolves true on Confirm', async () => {
    const root = mount();
    const p = confirmModal('T', 'M');
    rerender(root);
    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[1].click();
    await expect(p).resolves.toBe(true);
  });

  it('returns a Promise that resolves false on Cancel', async () => {
    const root = mount();
    const p = confirmModal('T', 'M');
    rerender(root);
    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[0].click();
    await expect(p).resolves.toBe(false);
  });

  it('returns a Promise that resolves false on Escape', async () => {
    const root = mount();
    const p = confirmModal('T', 'M');
    rerender(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBe(false);
  });
});

describe('promptModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    modalContent.value = null;
  });

  it('renders an input with the initial value and custom submit label', () => {
    const root = mount();
    promptModal(
      'Rename',
      { placeholder: 'new name', initialValue: 'foo', submitLabel: 'Save' },
      () => {},
    );
    rerender(root);

    const input = root.querySelector<HTMLInputElement>('input.input')!;
    expect(input.value).toBe('foo');
    expect(input.placeholder).toBe('new name');
    const submitBtn = root.querySelectorAll('.' + mstyles.actions + ' button')[1];
    expect(submitBtn.textContent).toBe('Save');
  });

  it('uses the primary button by default and applies custom submitClass', () => {
    const root = mount();
    promptModal('X', { submitClass: ctl.btnDanger }, () => {});
    rerender(root);
    const submit = root.querySelectorAll('.' + mstyles.actions + ' button')[1];
    expect(submit.className).toContain(ctl.btnDanger);
  });

  it('submit invokes the callback with the trimmed value', () => {
    const root = mount();
    const spy = vi.fn();
    promptModal('T', {}, spy);
    rerender(root);

    const input = root.querySelector<HTMLInputElement>('input.input');
    input!.value = '  new-value  ';
    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[1].click();

    expect(spy).toHaveBeenCalledWith('new-value', expect.any(Object));
  });

  it('submit with unchanged initialValue closes the modal without callback', () => {
    const root = mount();
    const spy = vi.fn();
    promptModal('T', { initialValue: 'same' }, spy);
    rerender(root);

    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[1].click();
    expect(spy).not.toHaveBeenCalled();
    expect(modalContent.value).toBeNull();
  });

  it('submit with empty value shows a hint and keeps the modal open', () => {
    const root = mount();
    const spy = vi.fn();
    promptModal('T', {}, spy);
    rerender(root);

    root.querySelector<HTMLInputElement>('input.input')!.value = '   ';
    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[1].click();
    expect(spy).not.toHaveBeenCalled();
    expect(modalContent.value).not.toBeNull();
    expect(root.querySelector('.input-hint')!.textContent).toBe('Please enter a value');
  });

  it('Enter key submits the form', () => {
    const root = mount();
    const spy = vi.fn();
    promptModal('T', {}, spy);
    rerender(root);

    const input = root.querySelector<HTMLInputElement>('input.input')!;
    input.value = 'typed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(spy).toHaveBeenCalledWith('typed', expect.any(Object));
  });

  it('Cancel button closes without calling onSubmit', () => {
    const root = mount();
    const spy = vi.fn();
    promptModal('T', {}, spy);
    rerender(root);

    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[0].click();
    expect(spy).not.toHaveBeenCalled();
    expect(modalContent.value).toBeNull();
  });

  it('renders the optional message above the input', () => {
    const root = mount();
    promptModal('T', { message: 'Heads up — read me.' }, () => {});
    rerender(root);
    expect(root.querySelector('.' + mstyles.message)!.textContent).toBe('Heads up — read me.');
  });

  it('Promise resolves to the submitted value when caller closes the modal', async () => {
    const root = mount();
    const p = promptModal('T', {}, (val) => {
      // Caller validates then closes the modal — typical sidebar create flow.
      if (val === 'ok') closeModal();
    });
    rerender(root);
    const input = root.querySelector<HTMLInputElement>('input.input');
    input!.value = 'ok';
    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[1].click();
    await expect(p).resolves.toBe('ok');
  });

  it('Promise resolves to null on Cancel', async () => {
    const root = mount();
    const p = promptModal('T', {}, () => {});
    rerender(root);
    root.querySelectorAll<HTMLElement>('.' + mstyles.actions + ' button')[0].click();
    await expect(p).resolves.toBeNull();
  });
});

// Layout-shift contract. jsdom has no layout, so these assert the STRUCTURE that
// produces a stable card — the geometry itself was measured in Chrome (regular
// modal: card height swung 551→661 and the tab row moved 56px before this; the
// search modal swung 591→850 and moved 129px. Both are 0 after).
describe('ModalBody stable / ModalActions footer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    modalContent.value = null;
  });

  it('marks a stable body so the card height rule can key off it', () => {
    const root = mount();
    openModal('Stable', () => <ModalBody stable>content</ModalBody>);
    rerender(root);
    const body = root.querySelector('.' + mstyles.body)!;
    expect(body.classList.contains(mstyles.stableBody)).toBe(true);
  });

  it('leaves an ordinary body unmarked, so 13 existing consumers keep hugging their content', () => {
    const root = mount();
    openModal('Plain', () => <ModalBody>content</ModalBody>);
    rerender(root);
    const body = root.querySelector('.' + mstyles.body)!;
    expect(body.classList.contains(mstyles.stableBody)).toBe(false);
  });

  it('marks a footer actions row, and leaves a plain one alone', () => {
    const root = mount();
    openModal('Footer', () => (
      <>
        <ModalActions footer>a</ModalActions>
        <ModalActions>b</ModalActions>
      </>
    ));
    rerender(root);
    const rows = [...root.querySelectorAll('.' + mstyles.actions)];
    expect(rows.map((r) => r.classList.contains(mstyles.actionsFooter))).toEqual([true, false]);
  });

  // The class is only half the mechanism: without the rules it names, the opt-in
  // is inert and nothing in jsdom would notice.
  it('keeps the rules the two opt-ins depend on', () => {
    const css = readFileSync('src/ui/Modal.module.css', 'utf8');
    // A stable height on the card, keyed off the body's class.
    expect(css).toMatch(/\.card:has\(\.stableBody\)\s*\{[^}]*height:/);
    // The body must be allowed to shrink below its content, or its flexible
    // child never resolves to a height and grows the card instead.
    expect(css).toMatch(/\.stableBody\s*\{[^}]*min-height:\s*0/);
    // A footer needs its own padding: it is a card child, outside .body's.
    expect(css).toMatch(/\.actionsFooter\s*\{[^}]*padding:/);
  });
});

// A label and its control are one unit. jsdom has no layout, so these assert the
// grouping and the rules that give it its spacing — the geometry was measured in
// Chrome: label-to-control went from 16px to 3px, and the header from 50 to 45.
describe('ModalField', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    modalContent.value = null;
  });

  function mountField(node: any) {
    const root = mount();
    openModal('Field', () => <ModalBody>{node}</ModalBody>);
    rerender(root);
    return root;
  }

  it('puts the label and the control in one element, not two body children', () => {
    const root = mountField(
      <ModalField label="Name">
        <input class="the-input" />
      </ModalField>,
    );
    const body = root.querySelector('.' + mstyles.body)!;
    const field = body.querySelector('.' + mstyles.field)!;
    const input = root.querySelector('.the-input')!;
    const label = root.querySelector('.' + mstyles.fieldLabel)!;

    // The body's gap separates SECTIONS. Left as siblings there, a label is pushed
    // as far from its own input as from the section above it.
    expect(field.parentElement).toBe(body);
    expect(field.contains(label)).toBe(true);
    expect(field.contains(input)).toBe(true);
    expect(label.nextElementSibling).toBe(input);
  });

  it('omits the label node entirely when no label is given', () => {
    const root = mountField(
      <ModalField>
        <input class="the-input" />
      </ModalField>,
    );
    expect(root.querySelector('.' + mstyles.fieldLabel)).toBeNull();
    expect(root.querySelector('.' + mstyles.field + ' .the-input')).not.toBeNull();
  });

  it('only the grow variant may absorb the card height', () => {
    const root = mountField(
      <>
        <ModalField label="Plain">
          <div />
        </ModalField>
        <ModalField label="Editor" grow>
          <div />
        </ModalField>
      </>,
    );
    const fields = [...root.querySelectorAll('.' + mstyles.field)];
    expect(fields.map((f) => f.classList.contains(mstyles.fieldGrow))).toEqual([false, true]);
  });

  it('keeps a caller class alongside its own', () => {
    const root = mountField(
      <ModalField label="X" class="caller-class">
        <div />
      </ModalField>,
    );
    const field = root.querySelector('.' + mstyles.field)!;
    expect(field.classList.contains('caller-class')).toBe(true);
  });

  // The classes are inert without these rules, and nothing in jsdom would notice.
  it('keeps the rules the grouping and the header corrections depend on', () => {
    const css = readFileSync('src/ui/Modal.module.css', 'utf8');
    expect(css).toMatch(/\.field\s*\{[^}]*flex-direction:\s*column/);
    // A grown field must be allowed to shrink, or the editor inside grows the card.
    expect(css).toMatch(/\.fieldGrow\s*\{[^}]*min-height:\s*0/);
    // Measured 4.21:1 as --text-secondary, under the 4.5:1 floor at 11px.
    expect(css).toMatch(/\.fieldLabel\s*\{[^}]*color:\s*var\(--text-primary\)/);
    // A 20px glyph with no padded hit area was the smallest target in the dialog.
    expect(css).toMatch(/\.close\s*\{[^}]*width:\s*28px/);
    expect(css).toMatch(/\.close\s*\{[^}]*height:\s*28px/);
  });

  // The hand-placed margins are what the rhythm replaces; one left behind puts a
  // single field back out of step, which is invisible in a unit test.
  it('leaves no hand-placed label margin in the four converted modals', () => {
    for (const f of [
      'src/mdh/components/IndexPanel.tsx',
      'src/mdh/components/SearchIndexPanel.tsx',
      'src/mdh/components/ImportWizard.tsx',
      'src/mdh/components/ExportWizard.tsx',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/ModalFieldLabel[^>]*margin-top/);
    }
  });
});
