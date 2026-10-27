// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import Band from '../src/rdc/components/Band.jsx';

const target = { name: 'Acme', host: 'acme.rossum.app', orgId: 31007, env: 'Production' as const };
const source = {
  name: 'test',
  domain: 'https://partner-sandbox.rossum.app',
  orgId: 20412,
  orgName: 'Acme Test',
};

let root: HTMLElement;
const mount = (el: any) => act(() => void render(el, root));
const unmount = () => act(() => void render(null, root));
function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduce, addEventListener() {}, removeEventListener() {} })),
  );
}
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Band', () => {
  it('without a source, shows the first-visit copy', () => {
    stubMotion(true);
    mount(<Band source={null} target={target} step={null} lastDeployment={null} />);
    const card = root.querySelector('[data-role="source"]')!;
    expect(card.textContent).toContain('Your source org');
    expect(card.textContent).toContain('Another org, only read');
    expect(card.textContent).toContain('for example a Sandbox');
  });

  it('shows the source name and host', () => {
    stubMotion(true);
    mount(<Band source={source} target={target} step={null} lastDeployment={null} />);
    const card = root.querySelector('[data-role="source"]')!;
    expect(card.textContent).toContain('test');
    expect(card.textContent).toContain('partner-sandbox.rossum.app');
  });

  it('marks earlier steps done and the current one current', () => {
    stubMotion(true);
    mount(<Band source={source} target={target} step="plan" lastDeployment={null} />);
    const state = (id: string) =>
      root.querySelector(`[data-step="${id}"]`)!.getAttribute('data-state');
    expect(state('connect')).toBe('done');
    expect(state('read')).toBe('done');
    expect(state('plan')).toBe('current');
    expect(state('review')).toBe('todo');
    expect(root.querySelector('[data-step="write"]')!.textContent).toContain('Write to Acme');
  });

  it('under reduced motion shows three still icons and never animates', () => {
    stubMotion(true);
    const animate = vi.fn();
    (Element.prototype as any).animate = animate;
    try {
      mount(<Band source={source} target={target} step={null} lastDeployment={null} />);
      expect(root.querySelectorAll('[data-belt-icon]')).toHaveLength(3);
      expect(animate).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as any).animate;
    }
  });

  it('spawns animated icons and removes them on unmount', () => {
    stubMotion(false);
    vi.useFakeTimers();
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    (Element.prototype as any).animate = animate;
    try {
      mount(<Band source={source} target={target} step={null} lastDeployment={null} />);
      expect(root.querySelectorAll('[data-belt-icon]')).toHaveLength(1);
      vi.advanceTimersByTime(2700);
      expect(root.querySelectorAll('[data-belt-icon]')).toHaveLength(2);
      unmount();
      expect(root.querySelectorAll('[data-belt-icon]')).toHaveLength(0);
      expect(cancel).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(5400);
      expect(animate).toHaveBeenCalledTimes(2);
    } finally {
      delete (Element.prototype as any).animate;
    }
  });

  it('shows a malformed source domain as it is', () => {
    stubMotion(true);
    mount(
      <Band
        source={{ ...source, domain: 'not a url' }}
        target={target}
        step={null}
        lastDeployment={null}
      />,
    );
    expect(root.querySelector('[data-role="source"]')!.textContent).toContain('not a url');
  });

  it('says so when nothing was deployed yet', () => {
    stubMotion(true);
    mount(<Band source={source} target={target} step={null} lastDeployment={null} />);
    expect(root.textContent).toContain('No deployment yet');
  });
});
