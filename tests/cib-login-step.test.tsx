// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import CoupaLoginStep from '../src/cib/components/CoupaLoginStep.jsx';
import type { LoginRoute } from '../src/cib/view.js';

let root: HTMLElement;
const mount = (route: LoginRoute, probe: string | null) => {
  const p = { onRoute: vi.fn(), onCreate: vi.fn(), onRemove: vi.fn() };
  act(
    () =>
      void render(
        <CoupaLoginStep
          route={route}
          probe={probe}
          probePage={probe && 'https://acme.rossum.app/extensions/my-extensions/908172'}
          busy={false}
          {...p}
        />,
        root,
      ),
  );
  return p;
};
const button = (text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const HOOK = 'https://acme.rossum.app/api/v1/hooks/908172';

describe('CoupaLoginStep panel', () => {
  it.each([
    ['browser', null, 'Ready. Nothing to set up.', null, null],
    ['org', null, 'Create the check function first', 'Create check function', 'onCreate'],
    [
      'org',
      HOOK,
      'Ready. Check logs in from the organization.',
      'Remove check function',
      'onRemove',
    ],
    [
      'browser',
      HOOK,
      'A check function still exists in this org',
      'Remove check function',
      'onRemove',
    ],
  ] as const)('%s, function %s → %s', (route, probe, heading, btn, handler) => {
    const p = mount(route, probe);
    expect(root.textContent).toContain(heading);
    const buttons = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim());
    if (!btn) expect(buttons).toEqual([]);
    else {
      expect(buttons).toEqual([btn]);
      act(() => button(btn)!.click());
      expect(p[handler!]).toHaveBeenCalledTimes(1);
    }
  });

  it('choosing the organization calls onRoute', () => {
    const p = mount('browser', null);
    const radio = root.querySelector<HTMLInputElement>('input[value="org"]')!;
    act(() => radio.click());
    expect(p.onRoute).toHaveBeenCalledWith('org');
  });
});
