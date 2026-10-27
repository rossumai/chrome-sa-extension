import { describe, it, expect } from 'vitest';
import { gridColumns, type ColumnState } from '../src/builder/gridColumns.js';

const st = (over: Partial<ColumnState> = {}): ColumnState => ({
  engine: false,
  ruleMode: false,
  hookMode: false,
  engineMode: false,
  values: false,
  panelOpen: false,
  panelWide: false,
  locked: false,
  ...over,
});

describe('gridColumns', () => {
  it('shows every editing column with nothing open', () => {
    expect(gridColumns(st())).toEqual([
      'grip',
      'id',
      'label',
      'source',
      'type',
      'flags',
      'rules',
      'matching',
      'hooks',
      'actions',
    ]);
  });

  it('adds AI with an engine and Value with an annotation, after the row actions', () => {
    const cols = gridColumns(st({ engine: true, values: true }));
    expect(cols.indexOf('ai')).toBe(cols.indexOf('type') + 1);
    expect(cols.at(-1)).toBe('value');
  });

  it('drops flags, AI and hooks while a panel is open', () => {
    const cols = gridColumns(st({ engine: true, panelOpen: true }));
    expect(cols).not.toContain('flags');
    expect(cols).not.toContain('ai');
    expect(cols).not.toContain('hooks');
    expect(cols).toContain('source');
  });

  it('rule mode: Rule config, no Matching, and no grip or actions while locked', () => {
    const cols = gridColumns(st({ ruleMode: true, locked: true, panelOpen: true }));
    expect(cols).toEqual(['id', 'label', 'source', 'type', 'rules', 'rule']);
  });

  it('engine mode keeps AI beside the panel and drops Rules and Matching', () => {
    const cols = gridColumns(st({ engine: true, engineMode: true, panelOpen: true }));
    expect(cols).toContain('ai');
    expect(cols).not.toContain('rules');
    expect(cols).not.toContain('matching');
  });

  it("a wide panel leaves ID and the mode's column, else ID and Label", () => {
    expect(gridColumns(st({ hookMode: true, panelOpen: true, panelWide: true }))).toEqual([
      'id',
      'mdh',
    ]);
    expect(
      gridColumns(st({ engine: true, engineMode: true, panelOpen: true, panelWide: true })),
    ).toEqual(['id', 'ai']);
    expect(gridColumns(st({ panelOpen: true, panelWide: true }))).toEqual(['id', 'label']);
  });
});
