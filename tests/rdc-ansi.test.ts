import { describe, it, expect } from 'vitest';
import { parseAnsi } from '../src/rdc/ansi.js';

const E = '\x1b';
const text = (line: string) =>
  parseAnsi(line)
    .map((s) => s.text)
    .join('');

describe('parseAnsi', () => {
  it('splits an rdc list line into time, action and message', () => {
    const line = `${E}[2m13:31:58${E}[0m ${E}[38;2;120;180;90mlist  ${E}[0m queues (8)`;
    expect(parseAnsi(line)).toEqual([
      { text: '13:31:58', style: { dim: true } },
      { text: ' ', style: {} },
      { text: 'list  ', style: { color: 'rgb(120, 180, 90)' } },
      { text: ' queues (8)', style: {} },
    ]);
  });

  it('splits an rdc idle line', () => {
    const line = `${E}[2m13:32:01${E}[0m ${E}[2midle  ${E}[0m envs match remote`;
    expect(parseAnsi(line)).toEqual([
      { text: '13:32:01', style: { dim: true } },
      { text: ' ', style: {} },
      { text: 'idle  ', style: { dim: true } },
      { text: ' envs match remote', style: {} },
    ]);
  });

  it('a line with no escapes is one plain segment', () => {
    expect(parseAnsi('pulled acme')).toEqual([{ text: 'pulled acme', style: {} }]);
    expect(parseAnsi('')).toEqual([]);
  });

  it('reset: ESC[0m and a bare ESC[m both clear every attribute', () => {
    expect(parseAnsi(`${E}[1;3;4;31ma${E}[0mb${E}[1mc${E}[md`)).toEqual([
      {
        text: 'a',
        style: { bold: true, italic: true, underline: true, color: 'var(--rdc-ansi-1)' },
      },
      { text: 'b', style: {} },
      { text: 'c', style: { bold: true } },
      { text: 'd', style: {} },
    ]);
  });

  it('basic, bright and default foreground', () => {
    expect(parseAnsi(`${E}[32ma${E}[95mb${E}[39mc`)).toEqual([
      { text: 'a', style: { color: 'var(--rdc-ansi-2)' } },
      { text: 'b', style: { color: 'var(--rdc-ansi-13)' } },
      { text: 'c', style: {} },
    ]);
  });

  it('256-colour foreground: basic range, cube and grey ramp', () => {
    expect(parseAnsi(`${E}[38;5;9ma`)[0].style).toEqual({ color: 'var(--rdc-ansi-9)' });
    expect(parseAnsi(`${E}[38;5;196ma`)[0].style).toEqual({ color: 'rgb(255, 0, 0)' });
    expect(parseAnsi(`${E}[38;5;232ma`)[0].style).toEqual({ color: 'rgb(8, 8, 8)' });
  });

  it('24-bit foreground', () => {
    expect(parseAnsi(`${E}[38;2;1;2;3macme`)).toEqual([
      { text: 'acme', style: { color: 'rgb(1, 2, 3)' } },
    ]);
  });

  it('ignores unknown codes, and never reads a background colour argument as a code', () => {
    // 5 (blink), 7 (inverse), 41 (red background) are ignored; 48;2;1;2;3 must not set bold (1)
    expect(parseAnsi(`${E}[5;7;41mx${E}[48;2;1;2;3my${E}[48;5;1mz`)).toEqual([
      { text: 'xyz', style: {} },
    ]);
  });

  it('strips non-SGR escapes so nothing raw shows', () => {
    const line = `${E}[2K${E}[1G${E}[?25lsyncing ${E}]0;title${E}\\acme${E}7 done${E}`;
    expect(text(line)).toBe('syncing acme done');
    expect(text(line)).not.toContain(E);
  });
});
