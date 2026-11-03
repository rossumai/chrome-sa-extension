// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, Fragment, render } from 'preact';
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import HelpPanel from '../src/help/HelpPanel.jsx';
import type { HelpSection } from '../src/help/HelpPanel.jsx';
import s from '../src/help/Help.module.css';

afterEach(() => {
  document.body.innerHTML = '';
});

const sections: HelpSection[] = [
  {
    id: 's1',
    title: 'First',
    chip: 'S1',
    keywords: 'alpha token',
    body: (
      <>
        <p>First body</p>
        <p>Second paragraph</p>
      </>
    ),
  },
  { id: 's2', title: 'Second', chip: 'S2', keywords: 'beta', body: <p>Second body</p> },
];

function renderPanel(props: Partial<Parameters<typeof HelpPanel>[0]> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  act(() => {
    render(
      <HelpPanel
        title="Help"
        placeholder="Search"
        sections={sections}
        onClose={() => {}}
        {...props}
      />,
      root,
    );
  });
  return root;
}

const search = (root: HTMLElement, q: string) =>
  act(() => {
    const input = root.querySelector('input')!;
    input.value = q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('HelpPanel', () => {
  it('filters sections by search query', () => {
    const root = renderPanel();
    expect(root.querySelectorAll('section').length).toBe(2);
    search(root, 'token');
    expect(root.querySelectorAll('section').length).toBe(1);
    expect(root.textContent).toContain('First');
  });

  it('shows empty message for no matches', () => {
    const root = renderPanel();
    search(root, 'zzz');
    expect(root.textContent).toContain('No help matches “zzz”');
  });

  it('the close button calls onClose', () => {
    const onClose = vi.fn();
    const root = renderPanel({ onClose });
    act(() => root.querySelector<HTMLButtonElement>('[aria-label="Close help"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('spreads titleBarProps onto the header, keeping its own class', () => {
    const onMouseDown = vi.fn();
    const root = renderPanel({ titleBarProps: { class: 'extra', onMouseDown } });
    const head = root.querySelector('[data-help-titlebar]')!;
    expect(head.classList.contains(s.panelHead)).toBe(true);
    expect(head.classList.contains('extra')).toBe(true);
    act(() => void head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it('has no frame of its own: no resize handle', () => {
    const root = renderPanel();
    expect(root.querySelector('[data-resize-handle]')).toBeNull();
  });

  it("gives a section's paragraphs the body's spacing", () => {
    const root = renderPanel();
    const sec = root.querySelector('section')!;
    expect(sec.classList.contains(s.sec)).toBe(true);
    expect(sec.querySelectorAll(':scope > p').length).toBe(2);
    const css = readFileSync('src/help/Help.module.css', 'utf8');
    const rule = css.match(/\.sec > p \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const margin = rule![1].match(/margin:\s*([^;]+);/)![1];
    expect(margin.split(/\s+/).some((v) => parseFloat(v) > 0)).toBe(true);
  });
});
