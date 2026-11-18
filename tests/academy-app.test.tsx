// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { h, render } from 'preact';
import * as store from '../src/academy/store.js';
import { initAcademy } from '../src/academy/index.jsx';
import { mintReceipt } from '../src/academy/mint.js';
import AcademyApp from '../src/academy/components/App.jsx';
import TrainerPanel from '../src/academy/components/TrainerPanel.jsx';
import { PROGRESS_KEY } from '../src/training/storage.js';
import { recordResults, taskState } from '../src/training/progress.js';
import { verifyReceipt } from '../src/training/receipt.js';
import { hmacSha256 } from '../src/training/hmac.js';
import { RECEIPT_KEY } from '../src/training/receiptKey.js';
import { progressThrough, noAssertion } from './support/training.js';

const ORIGIN = 'https://x.rossum.app';
let state: Record<string, any>;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  state = {};
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) =>
          Object.fromEntries(keys.filter((k) => k in state).map((k) => [k, state[k]])),
        ),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn() },
    tabs: {
      create: vi.fn(),
      getCurrent: vi.fn(async () => ({ id: 7, index: 3, windowId: 1 })),
    },
  } as any;
  store.setOrigin(ORIGIN);
  store.progress.value = null;
  store.selectedMission.value = null;
  store.error.value = null;
  store.mintNote.value = null;
  store.checkStatus.value = null;
  store.checking.value = false;
});

/** A fetch answering like an org where nothing has been built yet. */
function emptyOrg(over: Record<string, any> = {}) {
  return vi.fn(async (url: string) => {
    const path = url.replace(ORIGIN, '');
    const body =
      path in over
        ? over[path]
        : path.startsWith('/api/v1/auth/user')
          ? { id: 42, username: 'jan.novak@example.com' }
          : { results: [], result: [] };
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

describe('starting the project', () => {
  it('gives the run a code, names everything after it, and checks the first mission at once', async () => {
    sessionStorage.setItem('consoleDomain', ORIGIN);
    globalThis.fetch = emptyOrg() as any;
    await store.startTrack(
      () => 5,
      () => 0,
    );
    expect(store.progress.value!.run).toBe('barge-10');
    const kickoff = state[PROGRESS_KEY][ORIGIN].results['kickoff.queue'].assertions[0];
    expect(kickoff.state).toBe('no');
    expect(kickoff.label).toContain('AF · AP Invoices · barge-10');
    expect(store.checkStatus.value).toMatch(/^Checked your org at/);
  });

  it('fails closed without a console domain', async () => {
    await initAcademy();
    expect(store.connected.value).toBe(false);
    expect(store.error.value).toContain('popup');
  });
});

describe('the mission view', () => {
  it('shows the client, the trainee’s names, and what each task checks', async () => {
    store.progress.value = progressThrough(3);
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const text = document.body.textContent!;
    expect(text).toContain('Match every invoice to a vendor');
    expect(text).toContain('Dana Kowalski');
    expect(text).toContain('af_vendor_master_barge_17');
    expect(text).toContain('Done when the Academy sees:');
    expect(text).toContain('Its first query matches vat_id to {vendor_vat_id}');
    expect(document.querySelector('[aria-label="Your build"]')).toBeTruthy();
  });

  it('shows undone work as simply not done, and goes back to it', async () => {
    store.progress.value = recordResults(
      progressThrough(3),
      { 'kickoff.queue': [noAssertion()] },
      {},
      2,
    ).progress;
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    expect(document.querySelector('h1')!.textContent).toBe('Kickoff');
    const task = document.querySelector('[data-task="kickoff.queue"]')!;
    expect(task.getAttribute('data-state')).toBe('open');
    expect(task.textContent).toContain('1 thing to fix');
    expect(document.body.textContent).not.toMatch(/[Cc]hanged since/);
  });

  it('always opens Documents, next to this tab', async () => {
    store.progress.value = { ...progressThrough(1), build: { queueId: 31927 } };
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open Rossum')!.click();
    await flush();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `${ORIGIN}/documents`,
      index: 4, // right after the Console's tab (index 3)
      windowId: 1,
      openerTabId: 7,
    });
  });

  it('suggests the next mission on a mission that is already complete', () => {
    store.progress.value = progressThrough(1);
    store.selectedMission.value = 'kickoff';
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const note = document.querySelector('[aria-label="Mission complete"]')!;
    expect(note.textContent).toContain('Next: Capture what Acme needs');
    (note.querySelector('button') as HTMLElement).click();
    expect(store.selectedMission.value).toBe('fields');
  });

  it('says nothing of the kind on a mission still in progress', () => {
    store.progress.value = progressThrough(1);
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    expect(document.querySelector('[aria-label="Mission complete"]')).toBeNull();
  });

  it('says the names must be used exactly, and shows the run’s code', () => {
    store.progress.value = progressThrough(0);
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const names = document.querySelector('[aria-label="Names for this run"]')!;
    expect(names.textContent).toContain('Use these names exactly.');
    expect(names.textContent).toContain('barge-17');
    expect(names.querySelectorAll('code').length).toBe(4);
  });

  it('says Copied on a name’s Copy button, then reads Copy again', async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn(async () => {}) },
        configurable: true,
      });
      store.progress.value = progressThrough(0);
      render(<AcademyApp connected={true} />, document.getElementById('root')!);
      const btn = document.querySelector<HTMLElement>(
        '[aria-label="Copy AF · AP Invoices · barge-17"]',
      )!;
      btn.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('AF · AP Invoices · barge-17');
      expect(btn.getAttribute('aria-label')).toBe('Copied AF · AP Invoices · barge-17');
      expect(btn.querySelector('polyline')).toBeTruthy(); // the check
      expect(btn.textContent).toBe(''); // an icon, not a word
      await vi.advanceTimersByTimeAsync(1700);
      expect(btn.getAttribute('aria-label')).toBe('Copy AF · AP Invoices · barge-17');
      expect(btn.querySelector('rect')).toBeTruthy(); // the copy glyph again
    } finally {
      vi.useRealTimers();
    }
  });

  it('says Copy failed when the browser refuses the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      configurable: true,
    });
    store.progress.value = progressThrough(0);
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const btn = document.querySelector<HTMLElement>(
      '[aria-label="Copy af_vendor_master_barge_17"]',
    )!;
    btn.click();
    await flush();
    expect(btn.getAttribute('aria-label')).toBe('Copy failed');
    expect(btn.closest('[data-copy]')!.getAttribute('data-copy')).toBe('failed');
  });

  it('gives every run name in the copy its own Copy button, and other code none', () => {
    store.progress.value = progressThrough(0);
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const task = document.querySelector('[data-task="kickoff.queue"]')!;
    // In the title AND in the "Done when" line.
    expect(task.querySelectorAll('[aria-label="Copy AF · AP Invoices · barge-17"]').length).toBe(2);
    store.selectedMission.value = 'fields';
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const fields = document.querySelector('[data-task="fields.extract"]')!;
    expect(fields.querySelector('code')!.textContent).toBe('po_number');
    expect(fields.querySelector('[aria-label^="Copy"]')).toBeNull();
  });

  it('starts on a landing page that names the client and the six missions', () => {
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    expect(document.body.textContent).toContain('Acme Freight goes live');
    expect(document.querySelectorAll('ol li')).toHaveLength(6);
  });
});

describe('issuing the summary', () => {
  const BUILT = { queueId: 31927, hookId: 48211, ruleId: 9031, annotationId: 7712045 };
  const passingGet = () => {
    // Every task re-check answers as a finished org.
    const queue = {
      id: 31927,
      name: 'AF · AP Invoices · barge-17',
      schema: `${ORIGIN}/api/v1/schemas/5`,
    };
    const config = {
      source: {
        dataset: 'af_vendor_master_barge_17',
        queries: [{ find: { vat_id: '{vendor_vat_id}' } }],
      },
      mapping: { target_schema_id: 'vendor_match', dataset_key: 'id' },
    };
    const routes: Record<string, any> = {
      [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: {
        results: [queue],
      },
      '/api/v1/schemas/5': {
        id: 5,
        content: [
          { category: 'datapoint', id: 'po_number', type: 'string', rir_field_names: ['order_id'] },
          {
            category: 'datapoint',
            id: 'vendor_vat_id',
            type: 'string',
            rir_field_names: ['sender_vat_id'],
          },
          { category: 'datapoint', id: 'vendor_match', type: 'enum', rir_field_names: [] },
        ],
      },
      '/api/v1/hooks?queue=31927&page_size=100': {
        results: [
          {
            id: 48211,
            queues: [`${ORIGIN}/api/v1/queues/31927`],
            settings: { configurations: [config] },
          },
        ],
      },
      [`/api/v1/rules?name=${encodeURIComponent('AF · PO required · barge-17')}`]: {
        results: [
          {
            id: 9031,
            name: 'AF · PO required · barge-17',
            queues: [`${ORIGIN}/api/v1/queues/31927`],
            trigger_condition: 'is_empty(field.po_number)',
            actions: [{ type: 'show_message', enabled: true, payload: { type: 'error' } }],
          },
        ],
      },
      'POST /svc/data-storage/api/v1/collections/list': { result: ['af_vendor_master_barge_17'] },
      'POST /svc/data-storage/api/v1/data/aggregate': { result: [{ n: 40 }] },
      '/api/v1/annotations?queue=31927&page_size=1': { pagination: { total: 1 } },
      '/api/v1/annotations?queue=31927&status=confirmed,exported&ordering=-modified_at&page_size=5':
        { results: [{ id: 7712045 }] },
      '/api/v1/annotations/7712045/content': {
        content: [{ schema_id: 'vendor_match', content: { value: 'V001' } }],
      },
    };
    return vi.fn(async (path: string, opts?: { method?: string }) => {
      const key = opts?.method === 'POST' ? `POST ${path}` : path;
      if (!(key in routes)) throw new Error(`unexpected ${key}`);
      return routes[key];
    });
  };

  it('re-checks every task, then issues a summary the trainer’s check accepts', async () => {
    store.progress.value = { ...progressThrough(6), build: BUILT };
    const res = await mintReceipt({
      get: passingGet(),
      whoami: async () => ({ id: 42, username: 'jan.novak@example.com' }),
      now: () => new Date('2026-11-13T10:00:00Z'),
    });
    expect(res.ok).toBe(true);
    const verdict = await verifyReceipt(res.text, (m) => hmacSha256(RECEIPT_KEY, m));
    expect(verdict.valid).toBe(true);
    expect(verdict.fields).toMatchObject({
      host: 'x.rossum.app',
      ...BUILT,
      username: 'jan.novak@example.com',
    });
  });

  it('refuses when a task no longer passes, and names it', async () => {
    store.progress.value = { ...progressThrough(6), build: BUILT };
    const get = passingGet();
    get.mockImplementation(async (path: string, opts?: any) => {
      if (path.startsWith('/api/v1/rules')) return { results: [] };
      return passingGet()(path, opts);
    });
    const res = await mintReceipt({ get, whoami: async () => ({ id: 42, username: 'a' }) });
    expect(res).toMatchObject({ ok: false, reason: 'not-passing', failedTask: 'rules.create' });
    expect(taskState(store.progress.value!, 'rules.create')).toBe('open');
  });

  it('turns any rejection into a result rather than a stuck button', async () => {
    store.progress.value = progressThrough(6);
    const res = await mintReceipt({
      get: vi.fn(async () => {
        throw new Error('API 401');
      }),
      whoami: async () => ({}),
    });
    expect(res).toMatchObject({ ok: false, reason: 'error', message: 'API 401' });
  });
});

describe('TrainerPanel', () => {
  it('rejects a pasted summary that does not match its code', async () => {
    render(<TrainerPanel />, document.getElementById('root')!);
    const ta = document.querySelector('textarea')!;
    ta.value = 'ROSSUM ACADEMY — COMPLETION SUMMARY\nnonsense';
    (document.querySelector('button') as HTMLElement).click();
    await flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.body.textContent).toContain('Not valid');
  });
});

describe('starting over', () => {
  /** An org holding run barge-17's queue, schema, hook, rule and dataset; records every write. */
  function builtOrg() {
    const writes: string[] = [];
    const queue = {
      id: 31927,
      name: 'AF · AP Invoices · barge-17',
      schema: `${ORIGIN}/api/v1/schemas/5`,
    };
    const routes: Record<string, any> = {
      [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: {
        results: [queue],
      },
      '/api/v1/schemas/5': {
        id: 5,
        name: 'Tax invoices schema',
        queues: [`${ORIGIN}/api/v1/queues/31927`],
        content: [],
      },
      '/api/v1/hooks?queue=31927&page_size=100': {
        results: [
          {
            id: 48211,
            name: 'Acme matching',
            queues: [`${ORIGIN}/api/v1/queues/31927`],
            settings: { configurations: [{ source: { dataset: 'af_vendor_master_barge_17' } }] },
          },
          // Attached to another queue too: never ours to delete.
          {
            id: 1,
            name: 'Shared',
            queues: [`${ORIGIN}/api/v1/queues/31927`, `${ORIGIN}/api/v1/queues/9`],
            settings: { configurations: [{ source: { dataset: 'af_vendor_master_barge_17' } }] },
          },
        ],
      },
      [`/api/v1/rules?name=${encodeURIComponent('AF · PO required · barge-17')}`]: {
        results: [{ id: 9031, name: 'AF · PO required · barge-17', queues: [], actions: [] }],
      },
      'POST /svc/data-storage/api/v1/collections/list': { result: ['af_vendor_master_barge_17'] },
      'POST /svc/data-storage/api/v1/data/aggregate': { result: [{ n: 40 }] },
    };
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(ORIGIN, '');
      const method = init?.method || 'GET';
      if (method === 'DELETE' || path.endsWith('/collections/drop')) {
        writes.push(`${method} ${path}`);
        return { ok: true, status: 204, json: async () => null } as Response;
      }
      const key = method === 'POST' ? `POST ${path}` : path;
      if (!(key in routes)) throw new Error(`unexpected ${key}`);
      return { ok: true, status: 200, json: async () => routes[key] } as Response;
    }) as any;
    return writes;
  }

  beforeEach(() => {
    sessionStorage.setItem('consoleDomain', ORIGIN);
    store.progress.value = progressThrough(6);
    state[PROGRESS_KEY] = { [ORIGIN]: store.progress.value };
  });

  it('lists only what this run built and nothing another queue uses', async () => {
    builtOrg();
    await store.openStartOver();
    const s = store.startOver.value!;
    expect(s.phase).toBe('ready');
    expect((s as any).items.map((i: any) => `${i.kind} ${i.id ?? i.name}`)).toEqual([
      'rule 9031',
      'extension 48211',
      'queue 31927',
      'schema 5',
      'dataset af_vendor_master_barge_17',
    ]);
  });

  it('keeping them writes nothing and starts a run with a different code', async () => {
    const writes = builtOrg();
    await store.openStartOver();
    await store.startOverKeeping();
    expect(writes).toEqual([]);
    expect(store.progress.value!.run).not.toBe('barge-17');
    expect(store.progress.value!.results['vendors.dataset']).toBeUndefined();
  });

  it('deleting them deletes in order, at once, then starts a new run', async () => {
    const writes = builtOrg();
    await store.openStartOver();
    await store.startOverDeleting();
    expect(writes).toEqual([
      'DELETE /api/v1/rules/9031',
      'DELETE /api/v1/hooks/48211',
      'DELETE /api/v1/queues/31927?delete_after=0',
      'DELETE /api/v1/schemas/5',
      'POST /svc/data-storage/api/v1/collections/drop',
    ]);
    expect(store.startOver.value).toBeNull();
    expect(store.progress.value!.run).not.toBe('barge-17');
  });

  it('keeps the run, and lists what is left, when a delete fails', async () => {
    builtOrg();
    await store.openStartOver();
    const real = globalThis.fetch as any;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes('/queues/31927?delete_after=0')
        ? ({ ok: false, status: 403, json: async () => ({}) } as Response)
        : real(url, init),
    ) as any;
    await store.startOverDeleting();
    const s = store.startOver.value as any;
    expect(s.phase).toBe('failed');
    expect(s.failed.map((f: any) => f.item.kind)).toEqual(['queue']);
    expect(s.failed[0].message).toBe('API 403');
    expect(store.progress.value!.run).toBe('barge-17');
  });

  it('still offers a new run when the org cannot be read', async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response,
    ) as any;
    await store.openStartOver();
    expect(store.startOver.value).toMatchObject({ phase: 'error', message: 'API 401' });
    await store.startOverKeeping();
    expect(store.progress.value!.run).not.toBe('barge-17');
  });
});

describe('stopping and continuing later', () => {
  it('says progress is kept in this browser, not in the org, and shows the run code', () => {
    store.progress.value = progressThrough(2);
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    const text = document.querySelector('aside')!.textContent!;
    expect(text).toContain('Progress is saved in this browser');
    expect(text).not.toContain('from any computer');
    expect(document.querySelector('aside [aria-label="Copy barge-17"]')).toBeTruthy();
  });

  it('continues a run from its code, walking forward through what already passes', async () => {
    sessionStorage.setItem('consoleDomain', ORIGIN);
    store.progress.value = null;
    const queue = {
      id: 31927,
      name: 'AF · AP Invoices · barge-17',
      schema: `${ORIGIN}/api/v1/schemas/5`,
    };
    const routes: Record<string, any> = {
      [`/api/v1/queues?name=${encodeURIComponent('AF · AP Invoices · barge-17')}`]: {
        results: [queue],
      },
      '/api/v1/schemas/5': {
        id: 5,
        content: [
          { category: 'datapoint', id: 'po_number', type: 'string', rir_field_names: ['order_id'] },
          {
            category: 'datapoint',
            id: 'vendor_vat_id',
            type: 'string',
            rir_field_names: ['sender_vat_id'],
          },
          { category: 'datapoint', id: 'vendor_match', type: 'enum', rir_field_names: [] },
        ],
      },
      'POST /svc/data-storage/api/v1/collections/list': { result: [] },
    };
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(ORIGIN, '');
      const key = init?.method === 'POST' ? `POST ${path}` : path;
      return {
        ok: true,
        status: 200,
        json: async () => routes[key] ?? { results: [] },
      } as Response;
    }) as any;
    await store.continueRun('  Barge-17 ');
    const p = store.progress.value!;
    expect(p.run).toBe('barge-17');
    // Kickoff and the fields passed; it stops at the dataset.
    expect(
      Object.keys(p.results)
        .filter((id) => taskState(p, id) === 'ok')
        .sort(),
    ).toEqual(['fields.extract', 'fields.match', 'kickoff.queue']);
    expect(p.results['vendors.dataset'].assertions[0].state).toBe('no');
  });

  it('refuses something that is not a run code', async () => {
    store.progress.value = null;
    await store.continueRun('jnovak');
    expect(store.progress.value).toBeNull();
    expect(store.error.value).toContain('is not a run code');
  });

  it('offers to continue a run on the landing page', () => {
    store.progress.value = null;
    render(<AcademyApp connected={true} />, document.getElementById('root')!);
    expect(document.querySelector('#academy-run-code')).toBeTruthy();
  });
});
