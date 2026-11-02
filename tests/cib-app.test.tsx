// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../src/cib/release.js', async (orig) => ({
  ...(await orig<typeof import('../src/cib/release.js')>()),
  latestRelease: vi.fn(async () => 'v2.1.0'),
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

import App from '../src/cib/components/App.jsx';
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
