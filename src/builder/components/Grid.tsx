import { h, Fragment, type ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  work,
  selectedKey,
  fieldFilter,
  ruleFilterIds,
  ruleMarks,
  ruleGlobalMarks,
  onlyFabryChanges,
  fabryChangedKeys,
  hookFilterIds,
  validation,
  onlyMessages,
  onlyWarnings,
  warningKeys,
  engineMode,
} from '../store.js';
import { visibleKeys, narrow } from '../fieldFilter.js';
import { flatten } from '../model.js';
import { extractedFields } from '../engine.js';
import { DocEval, MarkIcons } from './GridCells.jsx';
import { columns, on, renderNode, addNewSection } from './GridRows.jsx';
import { fitColumns, WIDTHS, LABEL_MIN } from './columnFit.js';
import s from './Builder.module.css';

const HEAD: Record<string, ComponentChildren> = {
  id: 'ID',
  label: 'Label',
  rules: 'Rules',
  matching: 'Matching',
  hooks: 'Hooks',
  mdh: 'MDH',
  value: 'Value',
  rule: 'Rule config',
  type: 'Type',
  ai: 'AI',
  source: 'Source',
  grip: '',
  actions: '',
  flags: (
    <span class={s.flags}>
      <span title="Visible">Vis</span>
      <span title="Export">Exp</span>
      <span title="Required">Req</span>
    </span>
  ),
};

// One tooltip for the grid, shown at once over a cut-off ID or label. A signal, so a hover
// re-renders only the tooltip, not a grid of several hundred rows.
const cellTip = signal<{ text: string; x: number; y: number } | null>(null);

function CellTip() {
  useEffect(() => {
    const off = () => (cellTip.value = null);
    window.addEventListener('scroll', off, true);
    return () => window.removeEventListener('scroll', off, true);
  }, []);
  const tip = cellTip.value;
  return tip ? (
    <div class={s.cellTip} data-cell-tip="" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
      {tip.text}
    </div>
  ) : null;
}

// Cut off: the cell itself, or the ID inside it (beside a warning mark the ID is shortened
// on its own, so the cell no longer overflows).
const isCut = (el: Element) => el.scrollWidth > el.clientWidth;

function showTip(e: MouseEvent) {
  const td = (e.target as Element).closest?.('td[data-full]') as HTMLElement | null;
  if (!td || !(isCut(td) || [...td.children].some(isCut))) {
    if (cellTip.value) cellTip.value = null;
    return;
  }
  const r = td.getBoundingClientRect();
  cellTip.value = { text: td.dataset.full ?? '', x: r.left, y: r.bottom + 2 };
}

function rowEl(wrap: Element, key: string): Element | undefined {
  return [...wrap.querySelectorAll('tr[data-row-key]')].find(
    (r) => (r as HTMLElement).dataset.rowKey === key,
  );
}

function findAnchor(wrap: Element | null | undefined, selected: string | null) {
  if (!wrap) return null;
  const view = wrap.getBoundingClientRect();
  const rows = [...wrap.querySelectorAll('tr[data-row-key]')] as HTMLElement[];
  const inView = (r: Element) => {
    const b = r.getBoundingClientRect();
    return b.bottom > view.top && b.top < view.bottom;
  };
  const sel = selected != null ? rows.find((r) => r.dataset.rowKey === selected) : undefined;
  const row = sel && inView(sel) ? sel : rows.find(inView);
  return row ? { key: row.dataset.rowKey!, top: row.getBoundingClientRect().top } : null;
}

export default function Grid() {
  // The grid's width, measured, so columnFit can size the columns to it.
  const tableRef = useRef<HTMLTableElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const wrap = tableRef.current?.parentElement;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    // Resize in a later task, not inside the callback: a relayout during the observer's own
    // delivery re-triggers it, which Chrome reports as "ResizeObserver loop completed with
    // undelivered notifications". setAvail skips the render when the width did not change.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setAvail(wrap.clientWidth));
    });
    ro.observe(wrap);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);
  let show = visibleKeys(
    work.value,
    fieldFilter.value,
    ruleFilterIds.value ?? hookFilterIds.value,
    'or',
  );
  // Messages with no field go in the "Whole document" row; with "only fields with messages"
  // the grid keeps the fields that got one.
  const docMessages = validation.value?.placed.general ?? [];
  if (onlyMessages.value && validation.value) {
    const keys = new Set(
      flatten(work.value)
        .filter((r) => validation.value!.placed.byField.has(String(r.node.id)))
        .map((r) => r.key),
    );
    show = narrow(work.value, show, keys);
  }
  if (engineMode.value) {
    show = narrow(work.value, show, new Set(extractedFields(work.value).map((x) => x.node.__key)));
  }
  if (onlyWarnings.value) show = narrow(work.value, show, warningKeys.value);
  if (onlyFabryChanges.value) show = narrow(work.value, show, fabryChangedKeys.value);
  // The annotation's values go after every editing column, the row actions included.
  const ruleOn = !!ruleMarks.value;
  const cols = columns.value;
  // Opening or closing a panel changes the columns, and with them the row heights: keep the
  // selected (or last selected) row, else the top visible one, where it was on screen.
  const colKey = cols.join();
  const prevCols = useRef(colKey);
  const anchor = useRef<{ key: string; top: number } | null>(null);
  const lastSelected = useRef<string | null>(null); // closing a panel clears the selection
  if (prevCols.current !== colKey) {
    prevCols.current = colKey; // rendering, so the DOM still has the old rows
    const key = selectedKey.value ?? lastSelected.current;
    anchor.current = findAnchor(tableRef.current?.parentElement, key);
  }
  if (selectedKey.value != null) lastSelected.current = selectedKey.value;
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const wrap = tableRef.current?.parentElement;
    const el = a && wrap && rowEl(wrap, a.key);
    if (el) wrap.scrollTop += el.getBoundingClientRect().top - a.top;
  }, [colKey]);
  // Before the first measurement (and in tests): base widths, Label takes the rest.
  // 2px less: the collapsed table borders add a pixel past the columns, enough for a scrollbar.
  const fit = avail ? fitColumns(cols, avail - 2) : null;
  const tableStyle = fit
    ? { width: `${cols.reduce((sum, c) => sum + fit[c], 0)}px` }
    : {
        minWidth: `${(cols.includes('label') ? LABEL_MIN : 0) + cols.reduce((sum, c) => sum + (WIDTHS[c] ?? 0), 0)}px`,
      };
  const lead = cols.filter((c) => c !== 'rule' && c !== 'mdh' && c !== 'value').length;
  return (
    <Fragment>
      <table
        ref={tableRef}
        class={s.grid}
        style={tableStyle}
        onMouseOver={(e) => showTip(e as MouseEvent)}
        onMouseLeave={() => (cellTip.value = null)}
      >
        <colgroup>
          {cols.map((c) => (
            <col
              data-col={c}
              style={
                fit
                  ? { width: `${fit[c]}px` }
                  : c === 'label'
                    ? undefined
                    : { width: `${WIDTHS[c]}px` }
              }
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {cols.map((c) => (
              <th data-col={c}>{HEAD[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(ruleOn || docMessages.length > 0) && (
            <tr class={s.row + ' ' + s.sectionRow + ' ' + s.docRow} data-doc-row="">
              <td colSpan={lead}>Whole document</td>
              {on('rule') && (
                <td data-col="rule">
                  <MarkIcons marks={ruleGlobalMarks.value || []} />
                </td>
              )}
              {on('mdh') && <td />}
              {on('value') && (
                <td data-col="value" class={s.docMessages}>
                  <DocEval />
                  {docMessages.map((m) => (
                    <div>
                      <MarkIcons marks={[{ kind: m.type, text: m.content, event: 'validation' }]} />
                      {m.content}
                    </div>
                  ))}
                  {validation.value && (
                    <details>
                      <summary class={s.dim}>raw response</summary>
                      <pre class={s.code}>{JSON.stringify(validation.value.raw, null, 2)}</pre>
                    </details>
                  )}
                </td>
              )}
            </tr>
          )}
          {work.value.flatMap((n) => renderNode(n, 0, false, null, show))}
          {!show && (
            <tr class={s.addSectionRow}>
              <td colSpan={cols.length}>
                <button
                  type="button"
                  class="btn-link"
                  data-action="add-section"
                  onClick={addNewSection}
                >
                  + Add section
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CellTip />
    </Fragment>
  );
}
