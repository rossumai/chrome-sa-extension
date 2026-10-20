// @vitest-environment jsdom
//
// Rossum's "Developer mode" chip takes navbar room on a small screen, and only says what the
// extension's own Dev features switch already shows, so it is hidden.
import { describe, it, expect, beforeEach } from 'vitest';
import { documentsHeader, el } from './support/rossumHeader.js';
import { init, handleNode } from '../src/rossum/features/dev-mode-chip.js';

const chip = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.MuiChip-root')].find(
    (c) => c.querySelector('.MuiChip-label')!.textContent === label,
  )!;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the Developer mode chip', () => {
  it('is hidden when the navbar is already on the page', () => {
    documentsHeader({ chips: ['Developer mode'] });
    init();

    expect(chip('Developer mode').style.display).toBe('none');
  });

  it('is hidden when it renders later', () => {
    const header = documentsHeader();
    init();
    const late = el('div', [110, 12, 120, 24], { class: 'MuiChip-root MuiChip-colorWarning' });
    late.innerHTML = '<span class="MuiChip-label">Developer mode</span>';
    header.querySelector('.badge-row')!.prepend(late);
    handleNode(late);

    expect(late.style.display).toBe('none');
  });

  it('leaves Rossum’s other chips alone', () => {
    documentsHeader({ chips: ['Sandbox', 'Developer mode'] });
    init();

    expect(chip('Sandbox').style.display).toBe('');
  });

  it('leaves a chip outside the navbar’s badge row alone', () => {
    // Only the navbar's chip is the indicator; the same words elsewhere are content.
    const other = el('div', [0, 200, 120, 24], { class: 'MuiChip-root' });
    other.innerHTML = '<span class="MuiChip-label">Developer mode</span>';
    document.body.append(other);
    init();
    handleNode(other);

    expect(other.style.display).toBe('');
  });
});
