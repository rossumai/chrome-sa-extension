// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import Overview from '../src/rdc/components/Overview.jsx';
import ChooseSource from '../src/rdc/components/ChooseSource.jsx';
import { rateLimitError } from '../src/net/rateLimit.js';

const source = {
  name: 'test',
  domain: 'https://partner-sandbox.rossum.app',
  orgId: 20412,
  orgName: 'Acme Test',
};
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
      />,
    );
    act(() => byText('button', 'Choose the org to deploy from').click());
    expect(onChooseSource).toHaveBeenCalled();
  });

  it('with a source shows it, deploys, and notes the unbuilt parts', () => {
    const onDeploy = vi.fn();
    mount(
      <Overview source={source} targetName="Acme" onChooseSource={vi.fn()} onDeploy={onDeploy} />,
    );
    expect(root.textContent).toContain('Acme deploys from');
    act(() => byText('button', 'Deploy from test').click());
    expect(onDeploy).toHaveBeenCalled();
    const notes = root.querySelectorAll('[role="note"]');
    expect(notes).toHaveLength(3);
    notes.forEach((n) => expect(n.textContent).toContain('Not available yet.'));
  });
});

describe('ChooseSource', () => {
  it('finds, chooses and confirms an organization', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({
      results: [{ id: 20412, name: 'Acme Test' }],
    }));
    const onChosen = vi.fn();
    mount(<ChooseSource onCancel={vi.fn()} onChosen={onChosen} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(fetchOrgs).toHaveBeenCalledWith('https://partner-sandbox.rossum.app', 'tok');
    act(() => byText('button', 'Deploy from test').click());
    expect(onChosen).toHaveBeenCalledWith(source);
  });

  it('shows a 429 as rate limited, with no organization list', async () => {
    const fetchOrgs = vi.fn(async () => {
      throw rateLimitError({ headers: null }, 'HTTP 429');
    });
    mount(<ChooseSource onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'https://partner-sandbox.rossum.app');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.textContent).toMatch(/rate.limit/i);
    expect(root.querySelector('select')).toBeNull();
  });

  it('refuses a non-Rossum address without calling out', async () => {
    const fetchOrgs = vi.fn(async (_d: string, _t: string) => ({}));
    mount(<ChooseSource onCancel={vi.fn()} onChosen={vi.fn()} fetchOrgs={fetchOrgs} />);
    await type('rdc-src-address', 'ftp://x');
    await type('rdc-src-token', 'tok');
    act(() => byText('button', 'Find organizations').click());
    await flush();
    expect(root.textContent).toContain('Not a Rossum URL: ftp://x');
    expect(fetchOrgs).not.toHaveBeenCalled();
  });
});
