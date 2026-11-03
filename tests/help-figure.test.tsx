// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { h, render } from 'preact';
import HelpFigure from '../src/help/HelpFigure.jsx';
import type { Callout } from '../src/help/HelpFigure.jsx';

function renderFigure(props: { callouts: Callout[]; children: any }) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<HelpFigure {...props} />, root);
  return root;
}

describe('HelpFigure', () => {
  it('renders pins for found targets and notes for all callouts, with inert wrapper', async () => {
    const callouts: Callout[] = [
      { target: 'a', note: 'Note A' },
      { target: 'b', note: 'Note B' },
      { target: 'missing', note: 'Note Missing' },
    ];
    const root = renderFigure({
      callouts,
      children: (
        <div>
          <span data-help="a">Target A</span>
          <span data-help="b">Target B</span>
        </div>
      ),
    });

    // Wait for layout effect to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The frozen wrapper should have inert attribute
    const frozen = root.querySelector('[inert]');
    expect(frozen).toBeTruthy();

    // Should render 2 pins (for found targets a and b)
    const figure = root.querySelector('figure');
    // Pins are spans inside positioned divs (with left/top positioning)
    const stage = figure?.firstElementChild;
    const positionedDivs = Array.from(stage?.querySelectorAll('div') || []).filter(
      (div) => div.style.left !== '',
    );
    const pins = positionedDivs.map((div) => div.querySelector('span')).filter(Boolean);
    expect(pins.length).toBe(2);

    // Should render 3 notes (for all callouts)
    const notes = root.querySelectorAll('ol li');
    expect(notes.length).toBe(3);
    expect(notes[0]?.textContent).toContain('Note A');
    expect(notes[1]?.textContent).toContain('Note B');
    expect(notes[2]?.textContent).toContain('Note Missing');
  });

  it('marks pin and root as hot on note mouseenter, clears on mouseleave', async () => {
    const callouts: Callout[] = [
      { target: 'a', note: 'Note A' },
      { target: 'b', note: 'Note B' },
    ];
    const root = renderFigure({
      callouts,
      children: (
        <div>
          <span data-help="a">A</span>
          <span data-help="b">B</span>
        </div>
      ),
    });

    // Wait for layout effect to run
    await new Promise((resolve) => setTimeout(resolve, 0));

    const figure = root.querySelector('figure');
    const notes = root.querySelectorAll('ol li');
    // Get the divs inside the stage (callout boxes)
    const boxes = figure?.querySelectorAll('div > div:not([inert])');

    // Initially no hot state
    expect(figure?.getAttribute('data-hot')).toBeNull();
    // Check for absence of hot styling - the box won't have a specific "hot" class from CSS modules
    const initialClasses = boxes?.[1]?.className || '';

    // Mouseenter on note 2 (index 1)
    const note2 = notes[1] as HTMLElement;
    note2.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should set data-hot on root and box should have additional classes
    expect(figure?.getAttribute('data-hot')).toBe('1');
    const hotClasses = boxes?.[1]?.className || '';
    expect(hotClasses).not.toBe(initialClasses);
    expect(hotClasses.length).toBeGreaterThan(initialClasses.length);

    // Mouseleave clears both
    note2.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boxes?.[1]?.className).toBe(initialClasses);
    expect(figure?.getAttribute('data-hot')).toBeNull();
  });
});
