// @vitest-environment jsdom
//
// End-to-end behaviour of the regular Indexes panel: Copy emits a create-ready
// { indexName, keys, options } definition, diagnostics badges (type, redundant)
// render, and per-index size + collection totals come from $collStats.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h, render, Fragment } from 'preact';
import { useRef } from 'preact/hooks';

vi.mock('../src/mdh/api.js');
vi.mock('../src/mdh/cache.js', () => ({ get: () => null, set: () => {}, invalidate: () => {} }));
// Test-only escape hatch so a test can read what the stub's buffer currently
// holds without the component tree exposing it — set inside the factory's
// existing `if (editorRef)` block below. Does not change the stub's behaviour.
let lastEditorHandle: any = null;

// Stub CodeMirror. When used as the create-modal editor it gets an editorRef —
// expose a valid parsed index so the create flow can run; the read-only card
// body passes no editorRef and just renders the stub.
vi.mock('../src/mdh/components/JsonEditor.jsx', () => ({
  default: ({ value, editorRef, fill }: any) => {
    // Declared UNCONDITIONALLY: a hook inside `if (editorRef)` is a rules-of-hooks
    // violation (card editors pass no ref and would skip it), and it also puts
    // `bufRef` out of scope for the hand-edit handler below.
    //
    // useRef, NOT a plain `let`: a binding in a function component body is
    // re-initialised on every render, so the buffer would discard whatever
    // setValue wrote as soon as a tab click re-rendered the modal. Seeded from
    // the `value` prop, as the real JsonEditor does — hardcoding a different
    // string made the stub lie, since the modal seeds the editor with its
    // template and any code comparing getValue() against what it wrote saw a
    // mismatch that cannot happen in production.
    const bufRef = useRef(value || '{"keys":{"a":1}}');
    if (editorRef) {
      editorRef.current = {
        isValid: () => {
          try {
            JSON.parse(bufRef.current);
            return true;
          } catch {
            return false;
          }
        },
        getParsed: () => JSON.parse(bufRef.current),
        getValue: () => bufRef.current,
        setValue: (v: string) => {
          bufRef.current = v;
        },
        getError: () => '',
        focus: () => {},
        refresh: () => {},
      };
      lastEditorHandle = editorRef.current;
    }
    return (
      <div class="json-editor-stub" data-fill={fill ? '1' : undefined}>
        {/* Test-only escape hatch that mutates the buffer WITHOUT going through
            setValue — the only way to simulate a user hand-typing over what a
            tab wrote, which is exactly the distinction the dirty-editor guard
            has to make. Mirrors the sibling search-index suite. Nothing in the
            real editor renders a textarea. */}
        <textarea
          data-testid="json-editor-hand-edit"
          onInput={(e: any) => {
            bufRef.current = e.target.value;
          }}
        />
      </div>
    );
  },
}));

import * as api from '../src/mdh/api.js';
import IndexPanel from '../src/mdh/components/IndexPanel.jsx';
import Modal from '../src/mdh/components/Modal.jsx';
import mstyles from '../src/ui/Modal.module.css';
import { selectedCollection, activePanel, loading, error, opNotice } from '../src/mdh/store.js';
import seg from '../src/ui/Segmented.module.css';

const writeText = vi.fn().mockResolvedValue(undefined);

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<IndexPanel />, root);
  return root;
}

// Mounts the panel + Modal (signal-driven) so the Create Index flow is drivable.
function mountWithModal() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    <>
      <IndexPanel />
      <Modal />
    </>,
    root,
  );
  return root;
}
function buttonByText(root: any, text: any) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
}

function cardByName(root: any, name: any) {
  return [...root.querySelectorAll('.record-card')].find(
    (c) => c.querySelector('.record-summary strong')?.textContent === name,
  );
}
function badgeTexts(el: any) {
  return [...el.querySelectorAll('.index-badge')].map((b) => b.textContent.toLowerCase());
}

function editorHandle() {
  return lastEditorHandle;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  writeText.mockClear();
  selectedCollection.value = 'PRODUCTS';
  activePanel.value = 'indexes';
  loading.value = false;
  error.value = null;
  opNotice.value = null;
  // Stats are best-effort; default to a benign resolved value, overridden per test.
  vi.mocked(api.collectionStats).mockResolvedValue({ result: [] });
});

describe('IndexPanel — copy is create-ready', () => {
  it('Copy emits a clean { indexName, keys, options } definition', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [{ v: 2, key: { email: 1 }, name: 'email_1', unique: true }],
    });
    const root = mount();

    await vi.waitFor(() => expect(root.querySelector('.action-copy')).not.toBeNull());
    root.querySelector<HTMLElement>('.action-copy')!.click();

    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify(
        { indexName: 'email_1', keys: { email: 1 }, options: { unique: true } },
        null,
        2,
      ),
    );
  });

  it('copied JSON drops the internal v and is not the raw listed object', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [{ v: 2, key: { a: 1 }, name: 'a_1' }],
    });
    const root = mount();
    await vi.waitFor(() => expect(root.querySelector('.action-copy')).not.toBeNull());
    root.querySelector<HTMLElement>('.action-copy')!.click();
    const parsed = JSON.parse(writeText.mock.calls[0][0]);
    expect(parsed).toEqual({ indexName: 'a_1', keys: { a: 1 } });
    expect(parsed).not.toHaveProperty('v');
  });
});

describe('IndexPanel — diagnostics badges', () => {
  it('shows a type badge for compound but not for single-field indexes', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [
        { v: 2, key: { a: 1 }, name: 'a_1' },
        { v: 2, key: { x: 1, y: -1 }, name: 'x_1_y_-1' },
      ],
    });
    const root = mount();
    await vi.waitFor(() => expect(cardByName(root, 'x_1_y_-1')).toBeTruthy());

    expect(badgeTexts(cardByName(root, 'x_1_y_-1'))).toContain('compound');
    expect(badgeTexts(cardByName(root, 'a_1'))).not.toContain('single');
    expect(badgeTexts(cardByName(root, 'a_1'))).not.toContain('compound');
  });

  it('flags a plain prefix index as redundant', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [
        { v: 2, key: { a: 1 }, name: 'a_1' },
        { v: 2, key: { a: 1, b: 1 }, name: 'a_1_b_1' },
      ],
    });
    const root = mount();
    await vi.waitFor(() => expect(cardByName(root, 'a_1')).toBeTruthy());

    expect(badgeTexts(cardByName(root, 'a_1')).some((t) => t.includes('redundant'))).toBe(true);
    expect(badgeTexts(cardByName(root, 'a_1_b_1')).some((t) => t.includes('redundant'))).toBe(
      false,
    );
  });
});

describe('IndexPanel — size from $collStats', () => {
  it('shows per-index size and collection totals', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [{ v: 2, key: { ALT1: 1 }, name: 'products_alt1_idx' }],
    });
    vi.mocked(api.collectionStats).mockResolvedValue({
      result: [
        {
          count: 20581,
          totalIndexSize: 1216512,
          indexSizes: { _id_: 913408, products_alt1_idx: 303104 },
        },
      ],
    });
    const root = mount();

    await vi.waitFor(() => expect(cardByName(root, 'products_alt1_idx')).toBeTruthy());
    await vi.waitFor(() =>
      expect(cardByName(root, 'products_alt1_idx').textContent).toContain('296 KB'),
    );
    expect(root.querySelector('.toolbar')!.textContent).toContain('20,581');
  });

  it('degrades silently when $collStats fails', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [{ v: 2, key: { a: 1 }, name: 'a_1' }],
    });
    vi.mocked(api.collectionStats).mockRejectedValue(new Error('not authorized'));
    const root = mount();

    await vi.waitFor(() => expect(cardByName(root, 'a_1')).toBeTruthy());
    expect(error.value).toBeNull();
    expect(cardByName(root, 'a_1').querySelector('.index-card-meta')).toBeNull();
  });
});

describe('IndexPanel — async create surfaces operation outcome', () => {
  // api.post() surfaces the op id from the content-location header as res.operationId.
  const OP_ACCEPT = {
    code: 'accept',
    message: '',
    operationId: 'bb7001c1-89f3-4c61-b29b-a074e5e6f026',
  };

  async function openAndSubmitCreate(root: any) {
    await vi.waitFor(() => expect(buttonByText(root, '+ Create')).toBeTruthy());
    buttonByText(root, '+ Create').click();
    await vi.waitFor(() => expect(buttonByText(root, 'Create Index')).toBeTruthy());
    (
      root.querySelector('[role="dialog"]')!.querySelector('input.input') as HTMLInputElement
    ).value = 'new_idx';
    buttonByText(root, 'Create Index').click();
  }

  it('sets the red error banner (error.value) when the operation fails', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [] });
    vi.mocked(api.createIndex).mockResolvedValue(OP_ACCEPT);
    vi.mocked(api.waitForOperation).mockRejectedValue(new Error('E11000 duplicate key on a:1'));
    const root = mountWithModal();

    await openAndSubmitCreate(root);

    await vi.waitFor(() => expect(error.value).not.toBeNull());
    expect(error.value!.message).toContain('E11000 duplicate key on a:1');
    expect(error.value!.message).toContain('Creating index "new_idx"'); // labelled with context
    expect(opNotice.value).toBeNull(); // in-progress notice cleared
  });

  it('shows an info opNotice while running, then clears it and re-lists on finish', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [] });
    vi.mocked(api.createIndex).mockResolvedValue(OP_ACCEPT);
    let resolveOp: any;
    vi.mocked(api.waitForOperation).mockReturnValue(
      new Promise((r) => {
        resolveOp = r;
      }),
    );
    const root = mountWithModal();

    await vi.waitFor(() => expect(buttonByText(root, '+ Create')).toBeTruthy());
    const listCallsBefore = vi.mocked(api.listIndexes).mock.calls.length;
    await openAndSubmitCreate(root);

    await vi.waitFor(() => expect(opNotice.value).toMatchObject({ kind: 'info' }));
    resolveOp({ status: 'FINISHED' });
    await vi.waitFor(() => expect(opNotice.value).toBeNull());
    expect(vi.mocked(api.listIndexes).mock.calls.length).toBeGreaterThan(listCallsBefore); // re-list on finish
  });

  it('clears the in-progress opNotice when the collection changes mid-operation', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [] });
    vi.mocked(api.createIndex).mockResolvedValue(OP_ACCEPT);
    vi.mocked(api.waitForOperation).mockReturnValue(new Promise(() => {})); // never resolves → stays RUNNING
    const root = mountWithModal();

    await openAndSubmitCreate(root);
    await vi.waitFor(() => expect(opNotice.value).not.toBeNull());

    selectedCollection.value = 'OTHER_COLLECTION'; // switch collection while the op is in flight
    await vi.waitFor(() => expect(opNotice.value).toBeNull());
  });
});

describe('IndexPanel — collection summary', () => {
  it('warns when the collection has only _id_', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    const root = mount();
    // Anchor on the loaded card, not on `.index-list` (rendered unconditionally
    // from the first synchronous render, before `listIndexes` resolves) or a
    // plain "the summary node exists" check, which is satisfied by the
    // pre-load empty-indexes state just as well as by the loaded one.
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    expect(root.querySelector('[data-testid="index-summary"]')!.textContent).toContain('full scan');
  });

  it('renders no summary when there is nothing to say', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [
        { name: '_id_', key: { _id: 1 } },
        { name: 'by_code', key: { code: 1 } },
      ],
    });
    const root = mount();
    await vi.waitFor(() => expect(cardByName(root, 'by_code')).toBeTruthy());
    expect(root.querySelector('[data-testid="index-summary"]')).toBeNull();
  });
});

describe('IndexPanel — presets', () => {
  async function openCreate(root: HTMLElement) {
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
  }

  it('renders the preset row as tabs, like the other modals', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    expect(root.querySelector('[data-testid="index-preset-row"]')!.className).toContain(seg.tabs);
  });

  // A wildcard index already covers every single field, so offering a
  // single-field preset there would be offering a no-op.
  it('withholds the lookup-key preset when a wildcard index is present', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [
        { name: '_id_', key: { _id: 1 } },
        { name: '__dynamic_index', key: { '$**': 1 } },
      ],
    });
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    expect(root.querySelector('[data-testid="preset-lookup"]')).toBeNull();
    expect(root.querySelector('[data-testid="preset-cascade"]')).not.toBeNull();
  });

  // A SUBPATH wildcard (`{"a.$**": 1}`) indexes only paths under `a` — it does
  // not cover an unrelated field, so a single-field preset there is not a
  // no-op. Must use the narrow isFullWildcard, not the broad `includes('$**')`
  // test the redundancy rule and the summary sentence already had to fix.
  it('offers the lookup-key preset when the only wildcard is a subpath wildcard', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({
      result: [
        { name: '_id_', key: { _id: 1 } },
        { name: '__dynamic_index', key: { 'a.$**': 1 } },
      ],
    });
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    expect(root.querySelector('[data-testid="preset-lookup"]')).not.toBeNull();
  });

  // Task 3's contract is that a preset reaches the EDITOR. Asserting the
  // submitted payload needs a chosen field, and the field picker is Task 4 —
  // that end-to-end assertion lives there instead.
  it('writes the chosen preset into the editor', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await Promise.resolve();

    const written = JSON.parse(editorHandle()!.getValue());
    expect(written.options).toEqual({ unique: true });
    expect(written).toHaveProperty('keys');
  });

  // FINDING 3: a hidden/partial/sparse wildcard does not genuinely cover
  // every field (it serves no query, or only a subset of documents), so the
  // Lookup key preset is still useful there and must not be withheld — the
  // bug proved with a `hidden: true` wildcard, where the summary wrongly
  // claimed full coverage while redundancy correctly found nothing.
  it.each([
    ['hidden', { hidden: true }],
    ['partial', { partialFilterExpression: { status: 'active' } }],
    ['sparse', { sparse: true }],
  ])(
    'offers the lookup-key preset when the wildcard is %s (it does not cover everything)',
    async (_label, opts) => {
      vi.mocked(api.listIndexes).mockResolvedValue({
        result: [
          { name: '_id_', key: { _id: 1 } },
          { name: '__dynamic_index', key: { '$**': 1 }, ...opts },
        ],
      });
      const root = mountWithModal();
      await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
      await openCreate(root);
      expect(root.querySelector('[data-testid="preset-lookup"]')).not.toBeNull();
    },
  );

  // FINDING 6: the compound-ordering hint is only true for the two presets
  // that can actually emit more than one field — Lookup key and Expiring
  // both discard everything past the first field picked (indexPresets.ts),
  // so showing the hint there would be advice that does not apply.
  it('shows the ordering hint for Matching cascade and Unique key, not Lookup key or Expiring', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);

    const hasOrderHint = () =>
      [...root.querySelectorAll('div')].some((d) => d.textContent!.includes('Order matters'));

    (root.querySelector('[data-testid="preset-lookup"]') as HTMLElement).click();
    await Promise.resolve();
    expect(hasOrderHint()).toBe(false);

    (root.querySelector('[data-testid="preset-cascade"]') as HTMLElement).click();
    await Promise.resolve();
    expect(hasOrderHint()).toBe(true);

    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await Promise.resolve();
    expect(hasOrderHint()).toBe(true);

    (root.querySelector('[data-testid="preset-expiring"]') as HTMLElement).click();
    await Promise.resolve();
    expect(hasOrderHint()).toBe(false);
  });
});

describe('IndexPanel — field picker', () => {
  beforeEach(() => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
  });

  // Discovery is a convenience. Losing it must not stop anyone creating an index.
  it('falls back to a free-text path when discovery fails', async () => {
    vi.mocked(api.aggregate).mockRejectedValue(new Error('no discovery'));
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
    (root.querySelector('[data-testid="preset-cascade"]') as HTMLElement).click();
    await vi.waitFor(() => expect(vi.mocked(api.aggregate)).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(root.querySelector('[data-testid="index-field-fallback"]')).not.toBeNull(),
    );
  });

  it('submits the preset and the chosen field exactly', async () => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    vi.mocked(api.createIndex).mockResolvedValue({ operationId: null });
    vi.mocked(api.aggregate).mockRejectedValue(new Error('no discovery'));
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(root.querySelector('[data-testid="index-field-fallback"]')).not.toBeNull(),
    );

    const path = root.querySelector('[data-testid="index-field-fallback"]') as HTMLInputElement;
    path.value = 'code';
    path.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    (
      root.querySelector('[role="dialog"]')!.querySelector('input.input') as HTMLInputElement
    ).value = 'code_unique';
    const submit = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create Index',
    )!;
    submit.click();
    await Promise.resolve();
    await Promise.resolve();

    const [, indexName, keys, options] = vi.mocked(api.createIndex).mock.calls[0] as [
      string,
      string,
      any,
      any,
    ];
    expect(indexName).toBe('code_unique');
    expect(keys).toEqual({ code: 1 });
    expect(options).toEqual({ unique: true });
  });

  // FINDING 4: switching preset while discovery is still in flight aborts the
  // first call. The abort's own rejection settles ASYNCHRONOUSLY (a
  // microtask), landing after the second preset's effect has already run —
  // so a guard that reads stale `paths.loading` blocks the second preset from
  // ever starting its own discovery, leaving the picker stuck on the
  // free-text fallback for the rest of the modal session. The first call here
  // never resolves on its own — only an abort settles it — so if the second
  // preset's discovery never starts, this test times out.
  it('recovers the field picker after switching preset while discovery is in flight', async () => {
    let callCount = 0;
    vi.mocked(api.aggregate).mockImplementation((_collectionName, _pipeline, opts = {}) => {
      callCount++;
      const n = callCount;
      return new Promise((resolve, reject) => {
        if (n === 1) {
          // Only settles on abort — proves the SECOND preset's discovery
          // must start its own call rather than waiting on this one.
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        } else {
          resolve({ result: [{ f0: [{ _id: 'code', types: ['string'] }] }] });
        }
      });
    });
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();

    (root.querySelector('[data-testid="preset-cascade"]') as HTMLElement).click();
    await vi.waitFor(() => expect(callCount).toBe(1));

    // Switch preset before the first discovery call settles.
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();

    await vi.waitFor(() =>
      expect(root.querySelector('[data-testid="index-field-picker"]')).not.toBeNull(),
    );
  });

  // FINDING 5: a preset clicked with no field chosen writes `keys: {}` into
  // the editor, and `{}` is truthy, so the old `!keys` check let it through
  // to the API. The old hand-typed placeholder always shipped { field: 1 },
  // so this is a regression, not a pre-existing gap.
  // The name guard runs BEFORE the keys guard, so this test has to supply a name
  // to reach the assertion it is actually about.
  it('refuses to submit an index with no keys chosen', async () => {
    vi.mocked(api.aggregate).mockRejectedValue(new Error('no discovery'));
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();

    (root.querySelector('[data-testid="preset-lookup"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(root.querySelector('[data-testid="index-field-fallback"]')).not.toBeNull(),
    );
    // No field typed — the fallback input is left empty, so the preset wrote
    // keys: {}.
    expect(JSON.parse(editorHandle()!.getValue()).keys).toEqual({});

    (
      root.querySelector('[role="dialog"]')!.querySelector('input.input') as HTMLInputElement
    ).value = 'needs_keys';
    const submit = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create Index',
    )!;
    submit.click();
    await Promise.resolve();

    expect(api.createIndex).not.toHaveBeenCalled();
    expect(root.querySelector('.input-hint')!.textContent).toContain('at least one field');
  });
});

describe('IndexPanel — the Custom tab', () => {
  beforeEach(() => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
  });

  async function openCreate(root: HTMLElement) {
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
  }

  // Scoped to the open dialog: a card in the list behind the modal renders its
  // own JsonEditor through the very same stub and is earlier in DOM order, so an
  // unscoped query silently hits the card's textarea instead of the modal's.
  function handEdit(root: HTMLElement, json: string) {
    const dialog = root.querySelector('[role="dialog"]')!;
    const edit = dialog.querySelector(
      '[data-testid="json-editor-hand-edit"]',
    ) as HTMLTextAreaElement;
    edit.value = json;
    edit.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('is the first tab and is selected on open', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    const labels = [...root.querySelectorAll('[data-testid="index-preset-row"] button')].map(
      (n) => n.textContent,
    );
    expect(labels[0]).toBe('Custom');
    expect(root.querySelector('[data-testid="preset-custom"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  // Custom is now the state the modal OPENS in, and it generates nothing from
  // fields — so it must not trigger discovery. Without the guard, merely opening
  // the modal fires an aggregate, which this panel has never done.
  it('fires no aggregate merely by opening the modal', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    vi.mocked(api.aggregate).mockClear();
    await openCreate(root);
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(api.aggregate)).not.toHaveBeenCalled();
  });

  it('shows no field picker while Custom is selected', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    expect(root.querySelector('[data-testid="index-field-picker"]')).toBeNull();
    expect(root.querySelector('[data-testid="index-field-fallback"]')).toBeNull();
  });

  // Clicking back to Custom is a new path this tab creates, and it would
  // otherwise silently destroy hand-written JSON.
  it('asks before replacing a hand-edited editor when a tab is clicked', async () => {
    vi.mocked(api.aggregate).mockRejectedValue(new Error('no discovery'));
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    handEdit(root, '{"indexName":"mine","keys":{"hand_written":1}}');
    await Promise.resolve();
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await Promise.resolve();

    expect(root.textContent).toContain('Replace your edits');
    // The tab row stays mounted — replacing it would remount the editor below and
    // destroy the edits this confirm exists to protect.
    expect(root.querySelector('[data-testid="index-preset-row"]')).not.toBeNull();
  });

  it('"Keep mine" leaves the hand-edited definition untouched', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    handEdit(root, '{"indexName":"mine","keys":{"hand_written":1}}');
    await Promise.resolve();
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await Promise.resolve();
    const keep = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Keep mine')!;
    keep.click();
    await Promise.resolve();
    // The editor's BUFFER is what the guard protects — the textarea is only the
    // hand-typing escape hatch, and its DOM value is not the editor's content.
    expect(JSON.parse(editorHandle()!.getValue()).keys).toEqual({ hand_written: 1 });
    expect(root.querySelector('[data-testid="index-preset-row"]')).not.toBeNull();
  });

  it('restores the minimal template when Custom is chosen again', async () => {
    vi.mocked(api.aggregate).mockRejectedValue(new Error('no discovery'));
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await Promise.resolve();
    (root.querySelector('[data-testid="preset-custom"]') as HTMLElement).click();
    await Promise.resolve();
    expect(JSON.parse(editorHandle()!.getValue())).toEqual({ keys: { field: 1 }, options: {} });
  });
});

describe('IndexPanel — the name input', () => {
  beforeEach(() => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    vi.mocked(api.createIndex).mockResolvedValue({ operationId: null });
  });

  function dialogName(root: HTMLElement) {
    return root.querySelector('[role="dialog"]')!.querySelector('input.input') as HTMLInputElement;
  }

  async function openCreate(root: HTMLElement) {
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
  }

  function handEdit(root: HTMLElement, json: string) {
    const dialog = root.querySelector('[role="dialog"]')!;
    const edit = dialog.querySelector(
      '[data-testid="json-editor-hand-edit"]',
    ) as HTMLTextAreaElement;
    edit.value = json;
    edit.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('carries the name outside the editor, like the search-index modal', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    expect(dialogName(root)).not.toBeNull();
    expect(JSON.parse(editorHandle()!.getValue())).not.toHaveProperty('indexName');
  });

  // Never auto-filled: a suggested name goes stale the moment the fields change.
  it('leaves the name empty when a preset is chosen', async () => {
    vi.mocked(api.aggregate).mockRejectedValue(new Error('no discovery'));
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    (root.querySelector('[data-testid="preset-unique"]') as HTMLElement).click();
    await Promise.resolve();
    expect(dialogName(root).value).toBe('');
  });

  // Backward compatibility: a snippet saved from this panel — or from the build
  // that kept the name inside the JSON — must still paste and submit.
  it('lifts indexName out of a pasted legacy snippet into the name input', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    handEdit(root, '{"indexName":"legacy_idx","keys":{"email":1},"options":{"unique":true}}');
    await Promise.resolve();
    const submit = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create Index',
    )!;
    submit.click();
    await Promise.resolve();
    await Promise.resolve();

    const [, indexName, keys, options] = vi.mocked(api.createIndex).mock.calls[0] as [
      string,
      string,
      any,
      any,
    ];
    expect(indexName).toBe('legacy_idx');
    expect(keys).toEqual({ email: 1 });
    expect(options).toEqual({ unique: true });
  });

  it('refuses to submit with no name', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    const submit = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create Index',
    )!;
    submit.click();
    await Promise.resolve();
    expect(root.textContent).toContain('A name is required');
    expect(api.createIndex).not.toHaveBeenCalled();
  });
});

describe('IndexPanel — single-field presets constrain the picker', () => {
  beforeEach(() => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
    vi.mocked(api.aggregate).mockResolvedValue({
      result: [
        {
          f0: [
            { _id: 'code', types: ['string'] },
            { _id: 'created_at', types: ['date'] },
          ],
        },
      ],
    });
  });

  async function openWithPreset(root: HTMLElement, testid: string) {
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
    (root.querySelector(`[data-testid="${testid}"]`) as HTMLElement).click();
    await vi.waitFor(() =>
      expect(root.querySelector('[data-testid="index-field-picker"]')).not.toBeNull(),
    );
  }

  // The suggestion popup renders only while the input is focused, so a bare
  // input event proves nothing — focus first, then wait for the option.
  async function pick(root: HTMLElement, path: string) {
    const dialog = root.querySelector('[role="dialog"]')!;
    const input = dialog.querySelector('[data-testid="match-key-input"]') as HTMLInputElement;
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    input.value = path;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const item = await vi.waitFor(() => {
      const n = [...dialog.querySelectorAll('.match-key-suggest-item')].find(
        (b) => b.textContent === path,
      ) as HTMLElement | undefined;
      if (!n) throw new Error(`no suggestion for ${path}`);
      return n;
    });
    item.click();
    await vi.waitFor(() => expect(chips(root)).toContain(path));
  }

  function chips(root: HTMLElement) {
    return [...root.querySelectorAll('.match-key-chip')].map((c) =>
      c.textContent!.replace(/[×✕x]\s*$/, '').trim(),
    );
  }

  // The whole point: picking a second field REPLACES the first, so the chips can
  // never show a field the index does not use. Unreachable beats explained.
  it('replaces rather than adds a second field under Expiring', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openWithPreset(root, 'preset-expiring');
    await pick(root, 'created_at');
    await Promise.resolve();
    expect(chips(root)).toEqual(['created_at']);
    await pick(root, 'code');
    await Promise.resolve();
    expect(chips(root)).toEqual(['code']);
    expect(JSON.parse(editorHandle()!.getValue()).keys).toEqual({ code: 1 });
  });

  it('still accumulates fields under Matching cascade', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openWithPreset(root, 'preset-cascade');
    await pick(root, 'code');
    await Promise.resolve();
    await pick(root, 'created_at');
    await Promise.resolve();
    expect(chips(root)).toEqual(['code', 'created_at']);
    expect(JSON.parse(editorHandle()!.getValue()).keys).toEqual({ code: 1, created_at: 1 });
  });

  // Switching to a single-field preset visibly drops the extra chips — the
  // disappearance IS the explanation, and it needs no reading.
  it('drops the extra chips when switching from cascade to Expiring', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openWithPreset(root, 'preset-cascade');
    await pick(root, 'code');
    await Promise.resolve();
    await pick(root, 'created_at');
    await Promise.resolve();
    expect(chips(root)).toHaveLength(2);

    (root.querySelector('[data-testid="preset-expiring"]') as HTMLElement).click();
    await Promise.resolve();
    expect(chips(root)).toEqual(['code']);
    expect(JSON.parse(editorHandle()!.getValue()).keys).toEqual({ code: 1 });
  });

  it('labels the row singularly, naming what the field is for', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openWithPreset(root, 'preset-expiring');
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Date field to expire on');
    expect(dialog.textContent).not.toContain('Fields, in query order');
  });

  // The control must stop asking for what it discards.
  it('never offers "Add another field" for a single-field preset', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openWithPreset(root, 'preset-expiring');
    await pick(root, 'created_at');
    await Promise.resolve();
    const input = root
      .querySelector('[role="dialog"]')!
      .querySelector('[data-testid="match-key-input"]') as HTMLInputElement;
    expect(input.placeholder).not.toContain('another');
  });
});

// jsdom has no layout, so this asserts the STRUCTURE behind a card that does not
// resize as the user works. Measured in Chrome before the change: switching from
// Custom to Matching cascade grew the card 551→661px and moved the tab row 56px,
// because the card hugs its content and a centred card that grows moves its own
// top edge by half the delta. Both are 0px after, at 1000/700/577px viewports.
describe('IndexPanel — create modal holds its size', () => {
  beforeEach(() => {
    vi.mocked(api.listIndexes).mockResolvedValue({ result: [{ name: '_id_', key: { _id: 1 } }] });
  });

  async function openCreate(root: HTMLElement) {
    const create = [...root.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Create'),
    )!;
    create.click();
    await Promise.resolve();
  }

  it('flexes the body inside a stable card and pins the buttons outside it', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    const card = root.querySelector('[role="dialog"]')!;
    const body = card.querySelector('.' + mstyles.body)!;
    const submit = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Create Index',
    )!;

    expect(body.classList.contains(mstyles.stableBody)).toBe(true);
    // Inside the body the buttons scroll with the content and move whenever it
    // changes height; as a card child they cannot.
    expect(body.contains(submit)).toBe(false);
    expect(submit.closest('.' + mstyles.actions)!.parentElement).toBe(card);
  });

  it('groups each label with the control it names', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    const dialog = root.querySelector('[role="dialog"]')!;
    const pairs: [string, string][] = [
      ['Name', 'input.input'],
      ['Start from', '[data-testid="index-preset-row"]'],
    ];
    for (const [label, sel] of pairs) {
      const labelEl = [...dialog.querySelectorAll('.' + mstyles.fieldLabel)].find(
        (n) => n.textContent === label,
      )!;
      const field = labelEl.closest('.' + mstyles.field)!;
      expect(field).not.toBeNull();
      expect(field.querySelector(sel)).not.toBeNull();
    }
  });

  it('hands the editor its height rather than taking the editor from it', async () => {
    const root = mountWithModal();
    await vi.waitFor(() => expect(cardByName(root, '_id_')).toBeTruthy());
    await openCreate(root);
    // Scoped to the dialog: the index CARDS render editors of their own, and the
    // first one in document order is a card's, not the modal's.
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('.json-editor-stub')!.getAttribute('data-fill')).toBe('1');
  });
});
