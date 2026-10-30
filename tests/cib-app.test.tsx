// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../src/cib/release.js', async (orig) => ({
  ...(await orig<typeof import('../src/cib/release.js')>()),
  listReleases: vi.fn(async () => ['v2.1.0', 'v1.4.2']),
  loadRelease: vi.fn(async () => ({ plan: { ops: [] }, deployConfig: 'deploy/' })),
}));
vi.mock('../src/cib/engine.js', () => ({
  makeClient: () => ({
    call: async (_m: string, path: string) =>
      path.startsWith('organizations')
        ? { data: { results: [{ id: 123456 }] } }
        : path.startsWith('users')
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
  deployCib: vi.fn(),
}));

import App from '../src/cib/components/App.jsx';
import { deployCib } from '../src/cib/cib.js';
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
    expect(root.textContent).toContain('press Check and deploy again with the same run ID');
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

  it('a v1.x version shows the Deploy tool field, and v2.x hides it', async () => {
    const ver = root.querySelector<HTMLSelectElement>('#cib-version')!;
    expect(root.textContent).not.toContain('Deploy tool (v1.x settings)');
    await act(async () => {
      ver.value = 'v1.4.2';
      ver.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(root.textContent).toContain('Deploy tool (v1.x settings)');
  });

  it('editing the organization id hides the session hint', async () => {
    expect(root.textContent).toContain('Filled from your session');
    typeInto(root.querySelector<HTMLInputElement>('#cib-org')!, '999');
    expect(root.textContent).not.toContain('Filled from your session');
  });
});
