// src/builder/gridColumns.ts
// Which columns the grid shows, from what is open. Pure.

/** What the columns depend on. */
export type ColumnState = {
  /** The queue has an extraction engine (the AI column). */
  engine: boolean;
  /** A rule is open (its Rule config column). */
  ruleMode: boolean;
  /** An MDH hook is open (its MDH column). */
  hookMode: boolean;
  engineMode: boolean;
  /** An annotation is picked (its Value column). */
  values: boolean;
  panelOpen: boolean;
  panelWide: boolean;
  /** Rule or hook mode: the schema is read-only. */
  locked: boolean;
};

// While a right panel is open the grid drops the flags (the field inspector has them); a
// read-only schema also drops the grip and the row actions. Source and Type always stay.
const EDITING = ['grip', 'actions'];
const DETAIL = ['flags', 'ai', 'hooks'];

/**
 * The grid's columns, in order. Engine mode drops Rules and Matching, rule mode Matching, to
 * fit a 13" screen beside the panel: room for the AI seed pickers, and for Rule config. A
 * wide panel leaves only ID and the mode's Rule, MDH or (engine mode) AI column (ID and
 * Label when there is none).
 */
export function gridColumns(st: ColumnState): string[] {
  const cols = [
    'grip',
    'id',
    'label',
    'source',
    'type',
    ...(st.engine ? ['ai'] : []),
    'flags',
    'rules',
    'matching',
    'hooks',
    'actions',
    ...(st.ruleMode ? ['rule'] : []),
    ...(st.hookMode ? ['mdh'] : []),
    ...(st.values ? ['value'] : []),
  ].filter(
    (c) =>
      !(st.panelOpen && DETAIL.includes(c) && !(c === 'ai' && st.engineMode)) &&
      !(st.engineMode && ['rules', 'matching'].includes(c)) &&
      !(st.ruleMode && c === 'matching') &&
      !(st.locked && EDITING.includes(c)),
  );
  if (!(st.panelOpen && st.panelWide)) return cols;
  const modeCol = (c: string) => c === 'rule' || c === 'mdh' || (c === 'ai' && st.engineMode);
  const mode = cols.some(modeCol);
  return cols.filter((c) => c === 'id' || modeCol(c) || (!mode && c === 'label'));
}
