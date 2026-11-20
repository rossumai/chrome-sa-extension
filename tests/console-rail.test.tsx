// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { h, render } from 'preact';
import Rail from '../src/console/components/Rail.jsx';
import { activeApp, experimentalUnlocked } from '../src/console/store.js';
import markStyles from '../src/ui/FabryMark.module.css';
import styles from '../src/console/components/Rail.module.css';

// Component tests are .test.tsx and render with JSX, matching src/. Only .tsx is
// JSX-transformed, which is why the suite's non-component tests stay .test.ts.
function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(<Rail />, root);
  return root;
}

describe('Rail', () => {
  beforeEach(() => {
    activeApp.value = 'mdh';
    experimentalUnlocked.value = false;
  });

  it('renders the Inspector app button and switches to it on click', () => {
    const root = mount();
    const btn = [...root.querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'Annotation Inspector',
    );
    expect(btn).toBeTruthy();
    (btn as HTMLElement).click();
    expect(activeApp.value).toBe('inspector');
  });

  it('renders the Inspector as a normal (non-muted) rail item, positioned above Galaxy', () => {
    const root = mount();
    const items = [...root.querySelectorAll('.' + styles.item)];
    const idx = (title: any) => items.findIndex((b) => b.getAttribute('title') === title);
    const inspector = items[idx('Annotation Inspector')];
    expect(inspector.classList.contains(styles.muted)).toBe(false); // no dimming
    expect(items.some((b) => b.classList.contains(styles.muted))).toBe(false); // nothing is muted now
    expect(idx('Annotation Inspector')).toBeLessThan(idx('Org Galaxy')); // above Galaxy
  });

  // CIB sits right under Audit; Galaxy still comes before the Academy (visible once unlocked).
  it('orders CIB right after Audit, and Galaxy before Academy when the gate is unlocked', () => {
    experimentalUnlocked.value = true;
    const items = [...mount().querySelectorAll('.' + styles.item)];
    const title = (b: any) => b.getAttribute('title');
    const idx = (t: any) => items.findIndex((b) => title(b) === t);
    expect(idx('Mr. Fabry')).toBeLessThan(idx('Org Galaxy'));
    expect(idx('CIB deploy (Coupa Integration Baseline)')).toBe(idx('Audit Log Viewer') + 1);
    expect(idx('Org Galaxy')).toBeLessThan(idx('Onboarding training — experimental'));
  });

  it('renders the Galaxy app button and switches to it on click', () => {
    const root = mount();
    const btn = [...root.querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'Org Galaxy',
    );
    expect(btn).toBeTruthy();
    (btn as HTMLElement).click();
    expect(activeApp.value).toBe('galaxy');
  });

  it('marks the active app with its full name as the tooltip', () => {
    const root = mount();
    const active = root.querySelector('.' + styles.item + '.' + styles.active);
    expect(active!.getAttribute('title')).toBe('Dataset Management');
  });

  it('renders the Fabry rail icon as a STATIC shared FabryMark (no color cycle)', () => {
    const root = mount();
    const btn = [...root.querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'Mr. Fabry',
    );
    const svg = btn!.querySelector('svg')!;
    expect(svg.classList.contains(markStyles.mark)).toBe(true); // it's the shared mark
    expect(svg.classList.contains(markStyles.animated)).toBe(false); // rail is static
  });

  it('Galaxy rail item has no beta badge', () => {
    const root = mount();
    const btn = [...root.querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'Org Galaxy',
    );
    expect(btn!.querySelector('.' + styles.beta)).toBeNull();
  });

  it('re-renders the active marker after activeApp changes', () => {
    const root = mount();
    activeApp.value = 'audit';
    render(<Rail />, root);
    expect(root.querySelector('.' + styles.item + '.' + styles.active)!.getAttribute('title')).toBe(
      'Audit Log Viewer',
    );
  });
});

describe('Rail — fabry is public', () => {
  it('shows Fabry with its beta badge while the experimental gate is LOCKED', () => {
    experimentalUnlocked.value = false;
    const root = mount();
    const btn = [...root.querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'Mr. Fabry',
    )!;
    expect(btn).toBeTruthy();
    expect(btn.querySelector('.' + styles.beta)!.textContent).toBe('beta');
    expect(btn.querySelector('.' + styles.exp)).toBeNull(); // public: beta, never exp
    (btn as HTMLElement).click();
    expect(activeApp.value).toBe('fabry');
  });
});

describe('Rail — academy (experimental) gate', () => {
  const ACADEMY_TITLE = 'Onboarding training — experimental';

  it('hides Academy while the gate is locked', () => {
    experimentalUnlocked.value = false;
    const root = mount();
    expect(root.querySelectorAll('.' + styles.item).length).toBe(7); // the Academy, rdc and SFTP are gated
    expect(
      [...root.querySelectorAll('.' + styles.item)].some(
        (b) => b.getAttribute('title') === ACADEMY_TITLE,
      ),
    ).toBe(false);
  });

  it('shows Academy with an EXP badge when unlocked, and switches on click', () => {
    experimentalUnlocked.value = true;
    const root = mount();
    const btn = [...root.querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === ACADEMY_TITLE,
    )!;
    expect(btn).toBeTruthy();
    // exp REPLACES beta on a gated app: the badge names the gate it sits behind.
    expect(btn.querySelector('.' + styles.exp)!.textContent).toBe('exp');
    expect(btn.querySelector('.' + styles.beta)).toBeNull();
    (btn as HTMLElement).click();
    expect(activeApp.value).toBe('academy');
  });

  // The consolidation itself: ONE key now drives the Academy, not Fabry or CIB.
  // Before 2026-08-11 two keys drove two apps, and the pair of tests here
  // asserted they could not cross-unlock. The risk now runs the other way — that
  // the surviving gate quietly re-acquires Fabry — so that is what this pins.
  it('drives the Academy; Fabry and CIB are present in both gate states', () => {
    experimentalUnlocked.value = false;
    let titles = [...mount().querySelectorAll('.' + styles.item)].map((b) =>
      b.getAttribute('title'),
    );
    expect(titles).toContain('Mr. Fabry');
    expect(titles).not.toContain(ACADEMY_TITLE);
    expect(titles).toContain('CIB deploy (Coupa Integration Baseline)');

    experimentalUnlocked.value = true;
    titles = [...mount().querySelectorAll('.' + styles.item)].map((b) => b.getAttribute('title'));
    expect(titles).toContain('Mr. Fabry');
    expect(titles).toContain(ACADEMY_TITLE);
    expect(titles).toContain('CIB deploy (Coupa Integration Baseline)');
  });
});

describe('Rail — CIB is public', () => {
  it('shows CIB with no badge while the experimental gate is LOCKED, and switches on click', () => {
    experimentalUnlocked.value = false;
    const btn = [...mount().querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'CIB deploy (Coupa Integration Baseline)',
    )!;
    expect(btn).toBeTruthy();
    expect(btn.querySelector('.' + styles.beta)).toBeNull();
    expect(btn.querySelector('.' + styles.exp)).toBeNull();
    (btn as HTMLElement).click();
    expect(activeApp.value).toBe('cib');
  });

  it('marks the Builder as beta', () => {
    const btn = [...mount().querySelectorAll('.' + styles.item)].find(
      (b) => b.getAttribute('title') === 'Schema Builder',
    )!;
    expect(btn.querySelector('.' + styles.beta)).not.toBeNull();
  });
});
