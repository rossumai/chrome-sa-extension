// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import HelpWindow from '../src/help/HelpWindow.jsx';
import type { HelpSection } from '../src/help/HelpPanel.jsx';
import { HELP_RECT_KEY, helpRect } from '../src/help/rect.js';
import s from '../src/help/Help.module.css';

const mockSet = vi.fn((_v: any) => Promise.resolve());
const mockGet = vi.fn((_k: any) => Promise.resolve({} as Record<string, unknown>));
const realRects = Element.prototype.getClientRects;

const sections: HelpSection[] = [
  { id: 's1', title: 'First', chip: 'S1', keywords: 'alpha', body: <p>First body</p> },
];

let root: HTMLElement;
const frame = () => root.querySelector<HTMLElement>('[role="dialog"]');
const rectOf = (el: HTMLElement) => ({
  x: parseFloat(el.style.left),
  y: parseFloat(el.style.top),
  w: parseFloat(el.style.width),
  h: parseFloat(el.style.height),
});
const head = () => root.querySelector<HTMLElement>('[data-help-titlebar]')!;
const shield = () => root.querySelector('[data-help-shield]');
const mouse = (target: EventTarget, type: string, x: number, y: number) =>
  act(
    () =>
      void target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })),
  );
const escape = (target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(e));
  return e;
};

function mount(onClose = () => {}) {
  act(() => {
    render(
      <HelpWindow title="Help" placeholder="Search" sections={sections} onClose={onClose} />,
      root,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  helpRect.value = null;
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  (globalThis as any).chrome = { storage: { local: { set: mockSet, get: mockGet } } };
  // jsdom has no layout, so getClientRects is always empty: report a box unless the
  // element or an ancestor is display: none, which is what a real browser does
  Element.prototype.getClientRects = function (this: Element) {
    for (let el: Element | null = this; el; el = el.parentElement)
      if ((el as HTMLElement).style?.display === 'none') return [] as any;
    return [{}] as any;
  };
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => render(null, root));
  Element.prototype.getClientRects = realRects;
  document.body.innerHTML = '';
});

describe('HelpWindow', () => {
  it('opens at the default rect when nothing is stored', () => {
    mount();
    const f = frame()!;
    expect(f.getAttribute('aria-label')).toBe('Help');
    expect(f.getAttribute('aria-modal')).toBeNull();
    expect(rectOf(f)).toEqual({ x: 948, y: 48, w: 480, h: 840 });
    expect(root.textContent).toContain('First body');
  });

  it('opens at the stored rect, clamped, and reads storage only once', async () => {
    // rect.ts loads once per module instance: take fresh ones
    vi.resetModules();
    const rect = await import('../src/help/rect.js');
    const { default: Fresh } = await import('../src/help/HelpWindow.jsx');
    mockGet.mockResolvedValueOnce({ [HELP_RECT_KEY]: { x: 2000, y: 100, w: 500, h: 600 } });
    await act(() => rect.loadHelpRect());
    await act(() => rect.loadHelpRect());
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith([HELP_RECT_KEY]);
    act(() => {
      render(
        <Fresh title="Help" placeholder="Search" sections={sections} onClose={() => {}} />,
        root,
      );
    });
    expect(rectOf(frame()!)).toEqual({ x: 928, y: 100, w: 500, h: 600 });
  });

  it('falls back to the default for a junk stored rect', async () => {
    vi.resetModules();
    const rect = await import('../src/help/rect.js');
    mockGet.mockResolvedValueOnce({ [HELP_RECT_KEY]: 'x' });
    await act(() => rect.loadHelpRect());
    expect(rect.helpRect.value).toEqual({ x: 948, y: 48, w: 480, h: 840 });
  });

  it('moves by dragging the header, and saves once at mouseup', () => {
    helpRect.value = { x: 500, y: 100, w: 480, h: 500 };
    mount();
    mouse(head(), 'mousedown', 600, 110);
    expect(shield()).not.toBeNull();
    expect(frame()!.classList.contains(s.winActive)).toBe(true);
    mouse(window, 'mousemove', 550, 130);
    mouse(window, 'mousemove', 500, 160);
    expect(rectOf(frame()!)).toEqual({ x: 400, y: 150, w: 480, h: 500 });
    expect(mockSet).not.toHaveBeenCalled();
    mouse(window, 'mouseup', 500, 160);
    expect(shield()).toBeNull();
    expect(frame()!.classList.contains(s.winActive)).toBe(false);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ [HELP_RECT_KEY]: { x: 400, y: 150, w: 480, h: 500 } });
    expect(rectOf(frame()!)).toEqual({ x: 400, y: 150, w: 480, h: 500 });
  });

  it('a mousedown on the close button starts no move', () => {
    mount();
    const close = root.querySelector<HTMLElement>('[aria-label="Close help"]')!;
    mouse(close, 'mousedown', 1400, 60);
    expect(shield()).toBeNull();
    mouse(window, 'mousemove', 1300, 160);
    mouse(window, 'mouseup', 1300, 160);
    expect(rectOf(frame()!)).toEqual({ x: 948, y: 48, w: 480, h: 840 });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('resizes from the se handle, showing the size while dragging', () => {
    helpRect.value = { x: 500, y: 100, w: 480, h: 500 };
    mount();
    const se = root.querySelector<HTMLElement>('[data-edge="se"]')!;
    mouse(se, 'mousedown', 980, 600);
    mouse(window, 'mousemove', 1020, 630);
    expect(rectOf(frame()!)).toEqual({ x: 500, y: 100, w: 520, h: 530 });
    expect(root.querySelector('[data-help-size]')!.textContent).toBe('520 × 530');
    mouse(window, 'mouseup', 1020, 630);
    expect(mockSet).toHaveBeenCalledWith({ [HELP_RECT_KEY]: { x: 500, y: 100, w: 520, h: 530 } });
  });

  it('has a handle for every edge and corner', () => {
    mount();
    const edges = [...root.querySelectorAll('[data-edge]')].map((e) => e.getAttribute('data-edge'));
    expect(edges.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  it('an unmount mid-drag removes the shield and every listener', () => {
    mount();
    mouse(head(), 'mousedown', 1000, 100);
    expect(shield()).not.toBeNull();
    act(() => render(null, root));
    expect(frame()).toBeNull();
    expect(document.querySelector('[data-help-shield]')).toBeNull();
    // remounting starts from the stored rect: a stale listener would have moved it
    mouse(window, 'mousemove', 500, 500);
    mouse(window, 'mouseup', 500, 500);
    expect(mockSet).not.toHaveBeenCalled();
    expect(helpRect.value).toBeNull();
    mount();
    expect(rectOf(frame()!)).toEqual({ x: 948, y: 48, w: 480, h: 840 });
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    mount(onClose);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape another handler already used does not close', () => {
    const onClose = vi.fn();
    mount(onClose);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.addEventListener('keydown', (e) => e.preventDefault());
    escape(input);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape while the window is hidden does not close', () => {
    const onClose = vi.fn();
    root.style.display = 'none';
    mount(onClose);
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape after unmount does nothing', () => {
    const onClose = vi.fn();
    mount(onClose);
    act(() => render(null, root));
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('re-clamps when the browser window resizes', () => {
    helpRect.value = { x: 948, y: 48, w: 480, h: 840 };
    mount();
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(rectOf(frame()!)).toEqual({ x: 508, y: 12, w: 480, h: 676 });
  });
});
