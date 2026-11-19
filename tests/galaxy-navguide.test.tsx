// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { h, render } from 'preact';
import NavGuide from '../src/galaxy/components/NavGuide.jsx';
import styles from '../src/galaxy/components/NavGuide.module.css';

describe('NavGuide', () => {
  it('renders 5 help rows', () => {
    const root = document.createElement('div');
    render(<NavGuide />, root);
    expect(root.querySelectorAll('.' + styles.row).length).toBe(5);
  });

  it('contains "Rotate" and "Zoom" in the output', () => {
    const root = document.createElement('div');
    render(<NavGuide />, root);
    expect(root.textContent).toContain('Rotate');
    expect(root.textContent).toContain('Zoom');
  });
});
