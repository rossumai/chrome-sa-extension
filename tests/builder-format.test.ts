import { describe, it, expect } from 'vitest';
import { formatPython } from '../src/builder/format.js';

describe('formatPython', () => {
  it('returns the formatted code without the trailing newline Ruff adds', async () => {
    const r = await formatPython('x=1+2', async (s) => s.replace('x=1+2', 'x = 1 + 2') + '\n');
    expect(r).toEqual({ ok: true, text: 'x = 1 + 2' });
  });

  it('reports a syntax error instead of throwing', async () => {
    const r = await formatPython('x = (', async () => {
      throw new Error('Expected an expression');
    });
    expect(r).toEqual({ ok: false, error: 'Expected an expression' });
  });

  it('reports a loader failure the same way', async () => {
    const r = await formatPython('x', () => Promise.reject(new Error('failed to load ruff')));
    expect(r).toEqual({ ok: false, error: 'failed to load ruff' });
  });
});
