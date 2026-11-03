// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { CIB_HELP } from '../src/cib/help.jsx';

let root: HTMLElement;
const mount = async (body: any) => {
  root = document.createElement('div');
  document.body.appendChild(root);
  await act(async () => void render(<div>{body}</div>, root));
};
afterEach(() => {
  if (!root) return;
  render(null, root);
  root.remove();
});

// a pin is the numbered span inside a positioned callout box
const pins = (fig: Element) =>
  [...fig.firstElementChild!.children].filter(
    (el) => !el.hasAttribute('inert') && (el as HTMLElement).style.left !== '',
  );

describe('CIB help', () => {
  it('has the sections in order', () => {
    expect(CIB_HELP.map((s) => s.id)).toEqual([
      'what',
      'before',
      'step1',
      'step2',
      'step3',
      'step4',
      'step5',
      'trouble',
    ]);
  });

  it('every callout of every figure finds its part in the real component', async () => {
    let figures = 0;
    for (const sec of CIB_HELP) {
      await mount(sec.body);
      for (const fig of root.querySelectorAll('figure')) {
        figures++;
        const notes = fig.querySelectorAll('ol li').length;
        expect(notes, `${sec.id} has callouts`).toBeGreaterThan(0);
        expect(pins(fig).length, `${sec.id}: pins = callouts`).toBe(notes);
      }
      render(null, root);
      root.remove();
    }
    // steps 1 to 5 each have one figure
    expect(figures).toBe(5);
    await mount(null);
  });

  it('names no host but the placeholders', async () => {
    await mount(CIB_HELP.map((s) => s.body));
    const hosts =
      root.textContent!.match(/\b(?:[a-z0-9-]+\.)+(?:com|app|ai|io|net|org|cloud|dev)\b/gi) ?? [];
    expect(
      hosts.filter((x) => !['partner-sandbox.rossum.app', 'example.coupahost.com'].includes(x)),
    ).toEqual([]);
  });
});
