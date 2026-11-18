// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../src/cib/release.js', async (orig) => ({
  ...(await orig<typeof import('../src/cib/release.js')>()),
  latestRelease: vi.fn(async () => 'v2.1.0'),
  deployableReleases: vi.fn(async () => ['v2.1.0', 'v2.0.1', 'v2.0.0']),
  loadRelease: vi.fn(async () => ({ plan: { ops: [] }, deployConfig: 'deploy/' })),
}));
vi.mock('../src/cib/engine.js', () => ({
  makeClient: () => ({
    call: async (_m: string, path: string) =>
      path.startsWith('users')
        ? {
            data: {
              results: [
                {
                  username: 'jnovak',
                  first_name: 'Jana',
                  last_name: 'Novak',
                  email: 'j@example.com',
                },
              ],
            },
          }
        : { data: {} },
    list: async () => [],
  }),
}));
vi.mock('../src/cib/cib.js', async (orig) => ({
  ...(await orig<typeof import('../src/cib/cib.js')>()),
  findCoupaProbes: vi.fn(async () => []),
  readTarget: vi.fn(async () => ({ orgId: 123456, orgName: 'Acme', region: 'prod-eu2' })),
  checkpointRelease: vi.fn(async () => null),
  deployCib: vi.fn(),
}));

vi.mock('../src/cib/upgrade.js', async (orig) => ({
  ...(await orig<typeof import('../src/cib/upgrade.js')>()),
  findInstall: vi.fn(async () => null),
  guessInstalled: vi.fn(),
  installFromOrg: vi.fn(),
  upgradeCib: vi.fn(),
}));

import App from '../src/cib/components/App.jsx';
import { findInstall, guessInstalled, installFromOrg, upgradeCib } from '../src/cib/upgrade.js';
import { checkpointRelease, deployCib, readTarget } from '../src/cib/cib.js';
import { loadRelease } from '../src/cib/release.js';
import { domain, token } from '../src/cib/store.js';

let root: HTMLElement;
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
const button = (text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
const submit = async (name: 'check' | 'deploy') => {
  const b = root.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!;
  const form = b.closest('form')!;
  // jsdom has no requestSubmit submitter on click; dispatch a submit with the submitter
  const e = new Event('submit', { bubbles: true, cancelable: true });
  (e as any).submitter = b;
  await act(async () => void form.dispatchEvent(e));
  await flush();
};
const typeInto = (el: HTMLInputElement, value: string) =>
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeEach(async () => {
  root = document.createElement('div');
  document.body.appendChild(root);
  domain.value = 'https://acme.rossum.app';
  token.value = 't';
  (globalThis as any).chrome = { permissions: { request: vi.fn(async () => false) } };
  vi.mocked(deployCib).mockReset();
  vi.mocked(upgradeCib).mockReset();
  vi.mocked(guessInstalled).mockReset();
  vi.mocked(installFromOrg).mockReset();
  vi.mocked(findInstall).mockResolvedValue(null);
  vi.mocked(loadRelease).mockClear();
  vi.mocked(checkpointRelease).mockResolvedValue(null);
  Element.prototype.scrollIntoView = vi.fn();
  await act(async () => void render(<App connected={true} />, root));
  await flush();
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('CIB deploy page', () => {
  it('the buttons are labelled Check only and Check and deploy', () => {
    expect(button('Check only')).toBeTruthy();
    expect(button('Check and deploy')).toBeTruthy();
  });

  it('a Check only failure shows no Resume button', async () => {
    vi.mocked(deployCib).mockRejectedValue(new Error('boom'));
    await submit('check');
    expect(root.textContent).toContain('boom');
    expect(button('Resume deploy')).toBeUndefined();
  });

  it('a Check and deploy failure shows Resume, which runs a deploy again', async () => {
    vi.mocked(deployCib)
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValueOnce({
        status: 'done',
        idmap: {},
        invoked: [],
        pendingImports: [],
        notes: [],
      } as any);
    for (const id of ['cib-coupa-url', 'cib-coupa-id', 'cib-coupa-secret'])
      typeInto(root.querySelector<HTMLInputElement>('#' + id)!, 'x');
    await submit('deploy');
    // bold error, then what the run left behind; it stopped before writing anything
    const box = root.querySelector('[data-run-error]')!;
    expect(box.querySelector('b')!.textContent).toBe('502 Bad Gateway');
    expect(box.textContent).toContain('Nothing was written');
    // step 5 says why too, and the log keeps the line
    expect(root.querySelector('[data-verdict]')!.textContent).toContain('502 Bad Gateway');
    expect(root.querySelector('[data-log]')!.textContent).toContain('error: 502 Bad Gateway');
    await act(async () => button('Resume deploy')!.click());
    await flush();
    expect(vi.mocked(deployCib)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deployCib).mock.calls[1][1].checkOnly).toBe(false);
  });

  it('Resume goes through the form, so a field emptied after the error blocks it', async () => {
    vi.mocked(deployCib).mockRejectedValueOnce(new Error('502 Bad Gateway'));
    // fill the required credentials so the first submit is valid
    for (const id of ['cib-coupa-url', 'cib-coupa-id', 'cib-coupa-secret'])
      typeInto(root.querySelector<HTMLInputElement>('#' + id)!, 'x');
    await submit('deploy');
    typeInto(root.querySelector<HTMLInputElement>('#cib-coupa-url')!, '');
    await act(async () => button('Resume deploy')!.click());
    await flush();
    expect(vi.mocked(deployCib)).toHaveBeenCalledTimes(1);
  });

  it('an invalid Run ID opens the collapsed resume section', async () => {
    const details = root.querySelector<HTMLDetailsElement>('details')!;
    expect(details.open).toBe(false);
    const runId = root.querySelector<HTMLInputElement>('#cib-run')!;
    typeInto(runId, '');
    act(() => void runId.dispatchEvent(new Event('invalid', { cancelable: true })));
    expect(details.open).toBe(true);
  });

  it('the form is locked while a run is in flight', async () => {
    vi.mocked(deployCib).mockReturnValue(new Promise(() => {}));
    await submit('check');
    expect(root.querySelector('fieldset')!.disabled).toBe(true);
  });

  it('step 1 shows the latest release, the session organization and its region, read-only', () => {
    const t = root.querySelector('dl')!.textContent!;
    expect(t).toContain('v2.1.0');
    expect(t).toContain('Acme');
    expect(t).toContain('123456');
    expect(t).toContain('prod-eu2');
    for (const id of ['cib-version', 'cib-org', 'cib-region', 'cib-tool'])
      expect(root.querySelector('#' + id)).toBeNull();
    expect(root.textContent).not.toContain('Deploy tool');
  });

  it('a run deploys the latest release into the read organization and region', async () => {
    vi.mocked(deployCib).mockResolvedValue({ status: 'ready', notes: [] } as any);
    await submit('check');
    expect(vi.mocked(loadRelease).mock.calls[0][0]).toBe('v2.1.0');
    const opts = vi.mocked(deployCib).mock.calls[0][1];
    expect([opts.orgId, opts.region]).toEqual([123456, 'prod-eu2']);
  });

  it('a run with a checkpoint keeps the release it started with', async () => {
    vi.mocked(checkpointRelease).mockResolvedValueOnce('v2.0.0');
    vi.mocked(deployCib).mockResolvedValue({ status: 'ready', notes: [] } as any);
    await submit('check');
    expect(vi.mocked(loadRelease).mock.calls[0][0]).toBe('v2.0.0');
    expect(root.querySelector('[data-log]')!.textContent).toContain(
      'was started with CIB v2.0.0; it continues with it',
    );
  });

  it('step 1 shows the checkpoint release a run would resume with, not the latest', async () => {
    render(null, root);
    vi.mocked(checkpointRelease).mockResolvedValue('v2.0.0');
    await act(async () => void render(<App connected={true} />, root));
    await flush();
    const cell = root.querySelector('dl > div')!;
    expect(cell.textContent).toContain('v2.0.0');
    expect(cell.textContent).toContain('From checkpoint');
    expect(cell.textContent).not.toContain('latest');
    expect(cell.querySelector('a')!.getAttribute('href')).toMatch(/releases\/tag\/v2\.0\.0$/);
    // another run ID has no checkpoint: back to the latest
    vi.mocked(checkpointRelease).mockResolvedValue(null);
    typeInto(root.querySelector<HTMLInputElement>('#cib-run')!, 'cib-new');
    await flush();
    expect(cell.textContent).toContain('v2.1.0');
    expect(cell.textContent).toContain('Latest on GitHub');
  });

  it('a target that cannot be read is shown as an error, and nothing can run', async () => {
    render(null, root);
    vi.mocked(readTarget).mockRejectedValueOnce(
      new Error('this session does not see exactly one organization'),
    );
    await act(async () => void render(<App connected={true} />, root));
    await flush();
    expect(root.querySelector('[data-target-error]')!.textContent).toContain(
      'does not see exactly one organization',
    );
    expect(root.querySelector<HTMLButtonElement>('button[name="check"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[name="deploy"]')!.disabled).toBe(true);
  });
});

describe('CIB deploy help', () => {
  const helpButton = () =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.replace('?', '').trim() === 'Help',
    );
  const help = () => root.querySelector('[role="dialog"][aria-label="CIB deploy help"]');
  const realRects = Element.prototype.getClientRects;
  // jsdom has no layout: report a box, so the window counts as visible to its Escape handler
  beforeEach(() => {
    Element.prototype.getClientRects = () => [{}] as any;
  });
  afterEach(() => {
    Element.prototype.getClientRects = realRects;
  });
  const escape = (target: EventTarget) =>
    act(
      () =>
        void target.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
    );

  it('the Help button opens the window, and a second click closes it', async () => {
    expect(help()).toBeNull();
    await act(async () => helpButton()!.click());
    expect(help()!.textContent).toContain('CIB deploy help');
    await act(async () => helpButton()!.click());
    expect(help()).toBeNull();
  });

  it('is there when the page is not connected', async () => {
    render(null, root);
    await act(async () => void render(<App connected={false} />, root));
    expect(root.textContent).toContain('Not connected');
    await act(async () => helpButton()!.click());
    expect(help()!.textContent).toContain('CIB deploy help');
  });

  it('stays usable while a deploy is in flight', async () => {
    vi.mocked(deployCib).mockReturnValue(new Promise(() => {}));
    await submit('deploy');
    // the run is busy: the form's buttons are disabled, Help is not
    expect(root.querySelector('fieldset')!.disabled).toBe(true);
    expect(helpButton()!.disabled).toBe(false);
    await act(async () => helpButton()!.click());
    expect(help()!.textContent).toContain('CIB deploy help');
  });

  it('the first Escape in the owner field closes its list, the next closes the help', async () => {
    await act(async () => helpButton()!.click());
    const owner = root.querySelector<HTMLInputElement>('#cib-owner')!;
    act(() => owner.focus());
    expect(owner.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();
    escape(owner);
    expect(owner.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(help()).not.toBeNull();
    escape(owner);
    expect(help()).toBeNull();
  });

  it('Check upgrade without an install record suggests the closest release, then compares against it', async () => {
    const g = (tag: string, lacks: number) => ({ tag, found: 219, total: 219, lacks });
    vi.mocked(guessInstalled).mockResolvedValueOnce([
      g('v2.0.1', 22),
      g('v2.0.0', 23),
      g('v2.1.0', 61),
    ]);
    await act(async () => button('Check upgrade')!.click());
    await flush();
    expect(vi.mocked(guessInstalled).mock.calls[0][1].map((r) => r.tag)).toEqual([
      'v2.1.0',
      'v2.0.1',
      'v2.0.0',
    ]);
    expect(root.querySelector('[data-verdict]')!.textContent).toContain('looks like CIB v2.0.1');
    expect(root.querySelector<HTMLInputElement>('#cib-installed')!.value).toBe('v2.0.1');
    expect(vi.mocked(upgradeCib)).not.toHaveBeenCalled();

    // the second Check upgrade uses the filled tag; the Coupa values come from the org's schemas
    const install = { release: 'v2.0.1', recorded: false, idmap: {}, ops: [] };
    vi.mocked(installFromOrg).mockResolvedValueOnce({
      install,
      coupa: { baseUrl: 'https://x.coupahost.com/', clientId: 'CID' },
      fromOrg: true,
    });
    vi.mocked(upgradeCib).mockResolvedValueOnce({
      status: 'planned',
      from: 'v2.0.1',
      to: 'v2.1.0',
      items: [],
      blockers: [],
      notes: [],
    });
    await act(async () => button('Check upgrade')!.click());
    await flush();
    expect(vi.mocked(installFromOrg).mock.calls[0][1].tag).toBe('v2.0.1');
    const o = vi.mocked(upgradeCib).mock.calls[0][1];
    expect([o.install, o.coupa.clientId]).toEqual([install, 'CID']);
    expect(root.querySelector<HTMLInputElement>('#cib-coupa-id')!.value).toBe('CID');
  });

  it('a tie between releases suggests none', async () => {
    const g = (tag: string) => ({ tag, found: 219, total: 219, lacks: 5 });
    vi.mocked(guessInstalled).mockResolvedValueOnce([g('v2.0.1'), g('v2.0.0')]);
    await act(async () => button('Check upgrade')!.click());
    await flush();
    expect(root.querySelector('[data-verdict]')!.textContent).toContain('v2.0.1, v2.0.0 tie');
    expect(root.querySelector<HTMLInputElement>('#cib-installed')!.value).toBe('');
  });

  it('Check upgrade plans against the install record; Upgrade then writes under the release run ID', async () => {
    const install = {
      release: 'v2.0.0',
      recorded: true,
      idmap: {},
      ops: [
        {
          type: 'schemas',
          body: {
            content: [
              {
                id: 's',
                children: [
                  { id: 'oauth_client_id', default_value: 'CID' },
                  { id: 'coupa_api_base_url', default_value: 'https://x.coupahost.com/' },
                ],
              },
            ],
          },
        },
      ],
    };
    vi.mocked(findInstall).mockResolvedValue(install);
    const item = { key: 'hooks:1', type: 'hooks', name: 'H (CIB)', action: 'update' as const };
    vi.mocked(upgradeCib)
      .mockResolvedValueOnce({
        status: 'planned',
        from: 'v2.0.0',
        to: 'v2.1.0',
        items: [
          { ...item, fields: ['settings'], conflicts: ['config.x: release 1 -> 2'], removed: [] },
        ],
        blockers: [],
        notes: [],
      })
      .mockResolvedValueOnce({
        status: 'done',
        from: 'v2.0.0',
        to: 'v2.1.0',
        items: [{ ...item, fields: ['settings'], conflicts: [], removed: [] }],
        blockers: [],
        notes: [],
      });
    expect(button('Upgrade')!.disabled).toBe(true);
    await act(async () => button('Check upgrade')!.click());
    await flush();
    const o = vi.mocked(upgradeCib).mock.calls[0][1];
    expect([o.apply, o.run, o.coupa.clientId, o.region]).toEqual([
      false,
      'cib-upgrade-v2.1.0',
      'CID',
      'prod-eu2',
    ]);
    expect(root.querySelector('[data-upgrade]')!.textContent).toContain('H (CIB)');
    expect(root.querySelector('[data-verdict]')!.textContent).toContain('Upgrade plan');
    // the Coupa values of the record fill step 2
    expect(root.querySelector<HTMLInputElement>('#cib-coupa-id')!.value).toBe('CID');
    await act(async () => button('Upgrade')!.click());
    await flush();
    expect(vi.mocked(upgradeCib).mock.calls[1][1].apply).toBe(true);
    expect(root.querySelector('[data-verdict]')!.textContent).toContain('Upgraded to v2.1.0');
    expect(button('Upgrade')!.disabled).toBe(true);
  });

  it('with an install record, a value typed in step 2 wins over the record', async () => {
    const schema = {
      type: 'schemas',
      body: {
        content: [
          {
            id: 's',
            children: [
              { id: 'oauth_client_id', default_value: 'CID' },
              { id: 'coupa_api_base_url', default_value: 'https://x.coupahost.com/' },
            ],
          },
        ],
      },
    };
    vi.mocked(findInstall).mockResolvedValue({
      release: 'v2.0.0',
      recorded: true,
      idmap: {},
      ops: [schema],
    });
    vi.mocked(upgradeCib).mockResolvedValueOnce({
      status: 'planned',
      from: 'v2.0.0',
      to: 'v2.1.0',
      items: [],
      blockers: [],
      notes: [],
    });
    typeInto(root.querySelector<HTMLInputElement>('#cib-coupa-id')!, 'TYPED');
    await act(async () => button('Check upgrade')!.click());
    await flush();
    const o = vi.mocked(upgradeCib).mock.calls[0][1];
    expect([o.coupa.clientId, o.coupa.baseUrl]).toEqual(['TYPED', 'https://x.coupahost.com/']);
    expect(root.querySelector('[data-log]')!.textContent).toContain(
      'step 2 differs from the install record',
    );
  });
});
