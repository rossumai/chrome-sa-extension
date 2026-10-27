// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import Overview from '../src/rdc/components/Overview.jsx';
import ChooseSource, {
  fetchOrgs as defaultFetchOrgs,
} from '../src/rdc/components/ChooseSource.jsx';
import { rateLimitError, isRateLimited } from '../src/net/rateLimit.js';

const source = {
  name: 'test',
  domain: 'https://partner-sandbox.rossum.app',
  orgId: 20412,
  orgName: 'Acme Test',
};
const target = { targetDomain: 'https://acme.rossum.app', targetOrgId: 31007 };
let root: HTMLElement;
const mount = (el: any) => act(() => void render(el, root));
const flush = () => act(async () => {});
const byText = (sel: string, text: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text)!;
function type(id: string, value: string) {
  const el = root.querySelector<HTMLInputElement>('#' + id)!;
  return act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('Overview', () => {
  it('with no source offers to choose one', () => {
    const onChooseSource = vi.fn();
    mount(
      <Overview
        source={null}
        targetName="Acme"
        onChooseSource={onChooseSource}
        onDeploy={vi.fn()}
        onEditOwn={vi.fn()}
      />,
    );
    act(() => byText('button', 'Choose the org to deploy from').click());
    expect(onChooseSource).toHaveBeenCalled();
  });

  it('with a source shows it, deploys, and notes the unbuilt parts', () => {
    const onDeploy = vi.fn();
    mount(
      <Overview
        source={source}
        targetName="Acme"
        onChooseSource={vi.fn()}
        onDeploy={onDeploy}
        onEditOwn={vi.fn()}
      />,
    );
    expect(root.textContent).toContain('Acme deploys from');
    expect(root.textContent).toContain('Values a deployment will never overwrite.');
    act(() => byText('button', 'Deploy from test').click());
    expect(onDeploy).toHaveBeenCalled();
    const notes = root.querySelectorAll('[role="note"]');
    expect(notes).toHaveLength(3);
    notes.forEach((n) => expect(n.textContent).toContain('Not available yet.'));
  });
});

describe('Overview blocked', () => {
  it('disables Deploy with the reason when rdc is blocked', () => {
    const onDeploy = vi.fn();
    mount(
      <Overview
        source={source}
        targetName="Acme"
        onChooseSource={vi.fn()}
        onDeploy={onDeploy}
        blocked="rdc is not in this build."
        onEditOwn={vi.fn()}
      />,
    );
    const btn = byText('button', 'Deploy from test') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('rdc is not in this build.');
    expect(root.textContent).toContain('rdc is not in this build.');
  });
});

describe('ChooseSource', () => {
  it('finds, chooses and confirms an organization', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 20412, name: 'Acme Test' }],
    }));
    const onChosen = vi.fn();
    mount(
      <ChooseSource {...target} onCancel={vi.fn()} onChosen={onChosen} fetchOrgs={fetchOrgs} />,
    );
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(fetchOrgs).toHaveBeenCalledWith('https://partner-sandbox.rossum.app', 'tok');
    act(() => byText('button', 'Deploy from test').click());
    expect(onChosen).toHaveBeenCalledWith(source);
  });

  it('refuses the connected org itself as the source', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 31007, name: 'Acme' }],
    }));
    const onChosen = vi.fn();
    mount(
      <ChooseSource {...target} onCancel={vi.fn()} onChosen={onChosen} fetchOrgs={fetchOrgs} />,
    );
    await type('rdc-src-address', 'https://acme.rossum.app/');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    act(() => byText('button', 'Deploy from test').click());
    expect(root.textContent).toContain(
      'This is the org you are signed into. Choose another org to deploy from.',
    );
    expect(onChosen).not.toHaveBeenCalled();
  });

  it('allows the same org id on another host', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 31007, name: 'Acme' }],
    }));
    const onChosen = vi.fn();
    mount(
      <ChooseSource {...target} onCancel={vi.fn()} onChosen={onChosen} fetchOrgs={fetchOrgs} />,
    );
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    act(() => byText('button', 'Deploy from test').click());
    expect(onChosen).toHaveBeenCalled();
  });

  it('shows a thrown non-Error value, not undefined', async () => {
    const fetchOrgs = vi.fn(async () => {
      throw 'boom';
    });
    mount(<ChooseSource {...target} onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.textContent).toContain('Could not read the organizations: boom');
    expect(root.textContent).not.toContain('undefined');
  });

  it('says the short name is shown on this page', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 20412, name: 'Acme Test' }],
    }));
    mount(<ChooseSource {...target} onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.textContent).toContain('Shown on this page.');
  });

  it('shows a 429 as rate limited, with no organization list', async () => {
    const fetchOrgs = vi.fn(async () => {
      throw rateLimitError({ headers: null }, 'HTTP 429');
    });
    mount(<ChooseSource {...target} onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.textContent).toMatch(/rate.limit/i);
    expect(root.querySelector('select')).toBeNull();
  });

  it('refuses a non-Rossum address without calling out', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({}));
    mount(<ChooseSource {...target} onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'ftp://x');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.textContent).toContain('Not a Rossum URL: ftp://x');
    expect(fetchOrgs).not.toHaveBeenCalled();
  });

  it('forgets the found organizations when the address changes', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 20412, name: 'Acme Test' }],
    }));
    const onChosen = vi.fn();
    mount(
      <ChooseSource {...target} onCancel={vi.fn()} onChosen={onChosen} fetchOrgs={fetchOrgs} />,
    );
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.querySelector('select')).not.toBeNull();
    await type('rdc-src-address', 'https://other.rossum.app');
    expect(root.querySelector('select')).toBeNull();
    const confirm = byText('button', 'Deploy from test') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    act(() => confirm.click());
    expect(onChosen).not.toHaveBeenCalled();
  });

  it('re-enables Find when an edit outdates a read in flight', async () => {
    const fetchOrgs = vi.fn(() => new Promise<unknown>(() => {}));
    mount(<ChooseSource {...target} onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect((byText('button', 'Find organizations') as HTMLButtonElement).disabled).toBe(true);
    await type('rdc-src-address', 'https://other.rossum.app');
    expect((byText('button', 'Find organizations') as HTMLButtonElement).disabled).toBe(false);
  });

  it('trims the address and the token', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 1, name: 'x' }],
    }));
    mount(<ChooseSource {...target} onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', ' https://partner-sandbox.rossum.app ');
    await type('rdc-src-token', 'tok \n');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(fetchOrgs).toHaveBeenCalledWith('https://partner-sandbox.rossum.app', 'tok');
  });
});

describe('default fetchOrgs', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: object) => {
    const f = vi.fn(async () => res);
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('sends the bearer token to the organizations endpoint', async () => {
    const f = stub({ ok: true, status: 200, json: async () => ({ results: [] }) });
    await defaultFetchOrgs('https://partner-sandbox.rossum.app', 'tok');
    expect(f).toHaveBeenCalledWith('https://partner-sandbox.rossum.app/api/v1/organizations', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('throws the rate-limit error on 429', async () => {
    stub({ ok: false, status: 429, headers: { get: () => '7' } });
    const err: any = await defaultFetchOrgs('https://x.example', 't').catch((e: any) => e);
    expect(isRateLimited(err)).toBe(true);
    expect(err.retryAfter).toBe(7);
  });

  it('throws HTTP <status> otherwise', async () => {
    stub({ ok: false, status: 500 });
    await expect(defaultFetchOrgs('https://x.example', 't')).rejects.toThrow('HTTP 500');
  });
});
