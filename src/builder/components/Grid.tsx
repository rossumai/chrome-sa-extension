import { h, Fragment } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  work,
  status,
  rowErrors,
  selectedKey,
  values,
  lineRow,
  fieldFilter,
  ruleRoleById,
  fieldRules,
  ruleFilterIds,
  ruleMarks,
  ruleGlobalMarks,
  schemaLocked,
} from '../store.js';
import { visibleKeys } from '../fieldFilter.js';
import { apply, openRuleEditor } from '../index.jsx';
import {
  setAttr,
  setDeleted,
  addField,
  addSection,
  move,
  dropTarget,
  newDatapoint,
  newSection,
  newList,
  newTable,
  freshKeys,
  nextKey,
  flatten,
  type Node,
} from '../model.js';
import EditableCell from './EditableCell.jsx';
import Icon, { type IconName } from './icons.jsx';
import type { ActionMark } from '../rules.js';
import s from './Builder.module.css';

export const TYPES = ['string', 'number', 'date', 'enum', 'button'];
export const SOURCES = ['captured', 'data', 'manual', 'formula', 'reasoning'];

// The key of a just-added row, whose ID cell opens in edit mode.
const pendingEdit = signal<string | null>(null);

function kids(n: Node): Node[] {
  const c = n.children;
  return Array.isArray(c) ? c : c && typeof c === 'object' ? [c] : [];
}

function uniqueId(prefix: string): string {
  const ids = new Set(flatten(work.value).map((r) => r.node.id));
  let i = 1;
  while (ids.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

function edit(key: string, path: string[], value: unknown) {
  apply(setAttr(work.value, key, path, value));
}

function addFieldTo(parentKey: string) {
  const k = nextKey(work.value);
  apply(
    addField(work.value, parentKey, newDatapoint(k, uniqueId('new_field'), 'New field', 'string')),
  );
  pendingEdit.value = k;
  selectedKey.value = k;
}

function addListTo(parentKey: string) {
  const keys = freshKeys(work.value, 2);
  apply(addField(work.value, parentKey, newList(keys, uniqueId('new_list'), 'New list')));
  pendingEdit.value = keys[0];
  selectedKey.value = keys[0];
}

function addTableTo(parentKey: string) {
  const keys = freshKeys(work.value, 3);
  apply(addField(work.value, parentKey, newTable(keys, uniqueId('new_table'), 'New table')));
  pendingEdit.value = keys[0];
  selectedKey.value = keys[0];
}

function addNewSection() {
  const k = nextKey(work.value);
  apply(addSection(work.value, newSection(k, uniqueId('new_section'), 'New section')));
  pendingEdit.value = k;
  selectedKey.value = k;
}

// The three flags as icon toggles in Rossum's own style: green when on, grey and struck
// through when off.
const FLAG_ICONS = { visible: 'eye', export: 'export', required: 'asterisk' } as const;
const FLAG_TITLES = { visible: 'Visible', export: 'Export', required: 'Required' };

function FlagButton({
  flag,
  on,
  onToggle,
}: {
  flag: 'visible' | 'export' | 'required';
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      class={s.flag + (on ? ' ' + s.flagOn : '')}
      data-col={flag}
      aria-pressed={on ? 'true' : 'false'}
      title={`${FLAG_TITLES[flag]}: ${on ? 'on' : 'off'}`}
      disabled={schemaLocked.value}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!on);
      }}
    >
      <Icon name={FLAG_ICONS[flag]} slashed={!on} />
    </button>
  );
}

function SourceCell({ node }: { node: Node }) {
  const src = node.ui_configuration?.type;
  if (src !== undefined && !SOURCES.includes(src))
    return <span class={s.readonly}>{String(src)}</span>;
  return (
    <select
      class={s.select}
      disabled={schemaLocked.value}
      value={src ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        edit(node.__key, ['ui_configuration', 'type'], (e.currentTarget as HTMLSelectElement).value)
      }
    >
      {src === undefined && <option value="">(not set)</option>}
      {SOURCES.map((v) => (
        <option value={v}>{v}</option>
      ))}
    </select>
  );
}

function TypeCell({ node }: { node: Node }) {
  return (
    <select
      class={s.select}
      disabled={schemaLocked.value}
      value={node.type ?? 'string'}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        let next = setAttr(work.value, node.__key, ['type'], v);
        if (v === 'enum' && !Array.isArray(node.options))
          next = setAttr(next, node.__key, ['options'], []);
        apply(next);
      }}
    >
      {TYPES.map((v) => (
        <option value={v}>{v}</option>
      ))}
    </select>
  );
}

// The picked annotation's value for this row. A table column shows the row the table's
// stepper points at; the table row itself shows its row count and the stepper.
function ValueCell({ node, tableId }: { node: Node; tableId: string | null }) {
  const v = values.value!;
  if (node.category === 'multivalue') {
    const n = v.rows.get(node.id) ?? 0;
    const at = Math.min(lineRow.value[node.id] ?? 0, Math.max(0, n - 1));
    const go = (d: number) => (e: Event) => {
      e.stopPropagation();
      lineRow.value = { ...lineRow.value, [node.id]: at + d };
    };
    return (
      <span class={s.stepper}>
        {n} rows
        {n > 1 && (
          <span>
            <button
              type="button"
              class={s.iconBtn}
              data-action="prev-row"
              disabled={at === 0}
              onClick={go(-1)}
            >
              ‹
            </button>
            {at + 1}/{n}
            <button
              type="button"
              class={s.iconBtn}
              data-action="next-row"
              disabled={at >= n - 1}
              onClick={go(1)}
            >
              ›
            </button>
          </span>
        )}
      </span>
    );
  }
  if (node.category !== 'datapoint') return null;
  const list = v.values.get(node.id);
  const val = list?.[tableId ? (lineRow.value[tableId] ?? 0) : 0];
  if (val === undefined) return <span class={s.dim}>—</span>;
  return <span title={val}>{val}</span>;
}

// The field's rule count; one rule opens in the rule editor, several open a list to pick from.
const rulesMenuFor = signal<string | null>(null);

function RulesCell({ fieldId }: { fieldId: string }) {
  const list = fieldRules.value.get(fieldId) || [];
  const open = rulesMenuFor.value === fieldId;
  const wrap = useRef<HTMLSpanElement>(null);
  // While the list is open, a press anywhere outside it closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Element)) rulesMenuFor.value = null;
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const add = (
    <button
      type="button"
      class={s.rulesAdd}
      data-action="new-rule-for-field"
      title={`New rule for ${fieldId}`}
      onClick={(e) => {
        e.stopPropagation();
        openRuleEditor(null, fieldId);
      }}
    >
      +
    </button>
  );
  if (!list.length) return <span class={s.rulesWrap}>{add}</span>;
  return (
    <span class={s.rulesWrap} ref={wrap}>
      <button
        type="button"
        class={s.rulesCount}
        data-action="field-rules"
        title={list.map((x) => `${x.rule.name} (${x.rule.id})`).join('\n')}
        onClick={(e) => {
          e.stopPropagation();
          if (list.length === 1) openRuleEditor(list[0].rule.id);
          else rulesMenuFor.value = open ? null : fieldId;
        }}
      >
        {list.length}
      </button>
      {add}
      {open && (
        <div class={s.rulesMenu}>
          {list.map((x) => (
            <button
              type="button"
              data-rule-option={String(x.rule.id)}
              class={s.rulesOption}
              onClick={(e) => {
                e.stopPropagation();
                rulesMenuFor.value = null;
                openRuleEditor(x.rule.id);
              }}
            >
              {x.rule.name} ({x.rule.id})
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

const MARK_ICONS: Record<string, { icon: IconName; label: string }> = {
  error: { icon: 'error', label: 'Error message' },
  warning: { icon: 'warning', label: 'Warning message' },
  info: { icon: 'info', label: 'Info message' },
  show_hide: { icon: 'eye', label: 'Show/hide' },
  blocker: { icon: 'ban', label: 'Automation blocker' },
  send_email: { icon: 'mail', label: 'Send email' },
};

// One icon per action (Rossum's icon style, colored by kind); text and event on hover.
function MarkIcons({ marks }: { marks: ActionMark[] }) {
  if (!marks.length) return null;
  return (
    <span class={s.marks}>
      {marks.map((m) => {
        const k = MARK_ICONS[m.kind];
        return (
          <span
            class={s.mark + ' ' + (s[`mark_${m.kind}`] || '')}
            data-mark={m.kind}
            title={`${k?.label ?? m.kind}${m.text && m.text !== m.event ? `: ${m.text}` : ''} (${m.event})`}
          >
            <Icon name={k?.icon ?? 'zap'} size={14} />
          </span>
        );
      })}
    </span>
  );
}

function Row({
  node,
  depth,
  deleted,
  tableId,
}: {
  node: Node;
  depth: number;
  deleted: boolean;
  tableId: string | null;
}) {
  const key = node.__key;
  const st = status.value.get(key);
  const errs = rowErrors.value.get(key);
  const kind = node.category;
  const dp = kind === 'datapoint';
  const locked = schemaLocked.value;
  const role = kind === 'section' ? undefined : ruleRoleById.value?.get(node.id);
  const cls = [
    s.row,
    role ? s.ruleHit : '',
    kind === 'section' ? s.sectionRow : '',
    selectedKey.value === key ? s.selected : '',
    st === 'new' ? s.isNew : '',
    st === 'edited' ? s.isEdited : '',
    deleted ? s.isDeleted : '',
  ].join(' ');
  return (
    <tr
      class={cls}
      data-row-key={key}
      data-status={st === 'deleted' ? undefined : st}
      data-deleted={deleted ? 'true' : undefined}
      data-rule={role}
      onClick={() => (selectedKey.value = key)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (locked) return;
        const from = e.dataTransfer?.getData('text/plain');
        const t = from ? dropTarget(work.value, from, key) : null;
        if (from && t) apply(move(work.value, from, t.parent, t.index));
      }}
    >
      <td
        class={s.grip}
        draggable={!locked && !deleted && kind !== 'tuple'}
        onDragStart={(e) => e.dataTransfer?.setData('text/plain', key)}
        title="Drag to reorder"
      >
        {kind === 'tuple' ? '' : '⋮⋮'}
      </td>
      <td data-col="id" style={{ paddingLeft: `${6 + depth * 16}px` }}>
        {kind === 'section' && <span class={s.caret}>▾ </span>}
        {locked ? (
          <span class={s.mono}>{String(node.id ?? '')}</span>
        ) : (
          <EditableCell
            mono
            value={String(node.id ?? '')}
            autoEdit={pendingEdit.value === key}
            onCommit={(v) => {
              pendingEdit.value = null;
              edit(key, ['id'], v.trim());
            }}
          />
        )}
        {errs && (
          <div class={s.rowError}>
            {errs.map((m) => (
              <div>{m}</div>
            ))}
          </div>
        )}
      </td>
      <td data-col="label">
        {locked ? (
          String(node.label ?? '')
        ) : (
          <EditableCell
            value={String(node.label ?? '')}
            onCommit={(v) => edit(key, ['label'], v)}
          />
        )}
      </td>
      <td data-col="source">{dp ? <SourceCell node={node} /> : null}</td>
      <td data-col="type">
        {dp ? (
          <TypeCell node={node} />
        ) : (
          <span class={s.kind}>
            {kind === 'multivalue' ? 'table' : kind === 'tuple' ? 'row' : ''}
          </span>
        )}
      </td>
      <td data-col="flags">
        <span class={s.flags}>
          <span>
            {(dp || kind === 'multivalue') && (
              <FlagButton
                flag="visible"
                on={!node.hidden}
                onToggle={(v) => edit(key, ['hidden'], !v)}
              />
            )}
          </span>
          <span>
            {dp && (
              <FlagButton
                flag="export"
                on={node.can_export !== false}
                onToggle={(v) => edit(key, ['can_export'], v)}
              />
            )}
          </span>
          <span>
            {dp && (
              <FlagButton
                flag="required"
                on={!!node.constraints?.required}
                onToggle={(v) => edit(key, ['constraints', 'required'], v)}
              />
            )}
          </span>
        </span>
      </td>
      <td data-col="rules" class={s.rulesCell}>
        {kind !== 'section' && kind !== 'tuple' && node.id && (
          <RulesCell fieldId={String(node.id)} />
        )}
      </td>
      <td class={s.actions}>
        {locked ? null : node.__deleted ? (
          <button
            type="button"
            class={s.linkBtn}
            data-action="restore"
            onClick={(e) => {
              e.stopPropagation();
              apply(setDeleted(work.value, key, false));
            }}
          >
            Restore
          </button>
        ) : !deleted && kind !== 'tuple' ? (
          <button
            type="button"
            class={s.iconBtn}
            data-action="delete"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              apply(setDeleted(work.value, key, true));
            }}
          >
            ✕
          </button>
        ) : null}
      </td>
      {ruleMarks.value && (
        <td data-col="rule">
          {role === 'condition' || role === 'both' ? (
            <span class={s.ruleBadge} data-mark="if" title="The rule condition reads this field">
              if
            </span>
          ) : null}
          {kind !== 'section' && (
            <MarkIcons marks={ruleMarks.value.get(String(node.id ?? '')) || []} />
          )}
        </td>
      )}
      {values.value && (
        <td data-col="value" class={s.value}>
          <ValueCell node={node} tableId={tableId} />
        </td>
      )}
    </tr>
  );
}

// A section ends with three one-click adds; a table's row type ends with "+ Add column".
function AddRow({
  parentKey,
  depth,
  section,
}: {
  parentKey: string;
  depth: number;
  section: boolean;
}) {
  const link = (action: string, label: string, onClick: () => void) => (
    <button
      type="button"
      class={s.linkBtn}
      data-action={action}
      data-parent={parentKey}
      onClick={onClick}
    >
      + {label}
    </button>
  );
  return (
    <tr class={s.addRow}>
      <td />
      <td
        colSpan={7 + (ruleMarks.value ? 1 : 0) + (values.value ? 1 : 0)}
        style={{ paddingLeft: `${6 + depth * 16}px` }}
      >
        <span class={s.addLinks}>
          {section ? (
            <Fragment>
              {link('add-field', 'Field', () => addFieldTo(parentKey))}
              {link('add-list', 'List', () => addListTo(parentKey))}
              {link('add-table', 'Table', () => addTableTo(parentKey))}
            </Fragment>
          ) : (
            link('add-field', 'Add column', () => addFieldTo(parentKey))
          )}
        </span>
      </td>
    </tr>
  );
}

function renderNode(
  node: Node,
  depth: number,
  parentDeleted: boolean,
  tableId: string | null = null,
  show: Set<string> | null = null,
): any[] {
  if (show && !show.has(node.__key)) return [];
  const deleted = parentDeleted || !!node.__deleted;
  const out: any[] = [
    <Row key={node.__key} node={node} depth={depth} deleted={deleted} tableId={tableId} />,
  ];
  const childTable = node.category === 'multivalue' ? node.id : tableId;
  for (const c of kids(node)) out.push(...renderNode(c, depth + 1, deleted, childTable, show));
  // Adding while filtered would put a row the filter then hides; the links wait.
  if (show) return out;
  if (!deleted && node.category === 'section') {
    out.push(<AddRow key={node.__key + ':add'} parentKey={node.__key} depth={depth + 1} section />);
  }
  if (!deleted && node.category === 'tuple') {
    out.push(
      <AddRow key={node.__key + ':add'} parentKey={node.__key} depth={depth + 1} section={false} />,
    );
  }
  return out;
}

const WIDTHS_KEY = 'builderColumnWidths';
const COLS = ['id', 'label', 'source', 'type', 'flags', 'rules'];
const DEFAULT_WIDTHS: Record<string, number> = {
  id: 220,
  label: 200,
  type: 90,
  source: 110,
  flags: 110,
  rules: 64,
  value: 180,
  rule: 110,
};
const MIN_WIDTH = 50;
const widths = signal<Record<string, number>>({ ...DEFAULT_WIDTHS });
let widthsLoaded = false;

function loadWidths() {
  if (widthsLoaded) return;
  widthsLoaded = true;
  globalThis.chrome?.storage?.local
    ?.get([WIDTHS_KEY])
    .then((v) => {
      const saved = v?.[WIDTHS_KEY];
      if (saved && typeof saved === 'object') widths.value = { ...DEFAULT_WIDTHS, ...saved };
    })
    .catch(() => {});
}

// Drag a header's right edge; the width is saved when the drag ends.
function startResize(col: string, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = widths.value[col];
  const onMove = (m: MouseEvent) => {
    widths.value = { ...widths.value, [col]: Math.max(MIN_WIDTH, startW + m.clientX - startX) };
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    globalThis.chrome?.storage?.local?.set({ [WIDTHS_KEY]: widths.value })?.catch(() => {});
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

const HEAD: Record<string, any> = {
  id: 'ID',
  label: 'Label',
  rules: 'Rules',
  value: 'Value',
  rule: 'Rule',
  type: 'Type',
  source: 'Source',
  flags: (
    <span class={s.flags}>
      <span title="Visible">Vis</span>
      <span title="Export">Exp</span>
      <span title="Required">Req</span>
    </span>
  ),
};

export default function Grid() {
  useEffect(loadWidths, []);
  const w = widths.value;
  const show = visibleKeys(work.value, fieldFilter.value, ruleFilterIds.value, 'or');
  // The annotation's values go after every editing column, the row actions included.
  const ruleOn = !!ruleMarks.value;
  const cols = [...COLS, ...(ruleOn ? ['rule'] : []), ...(values.value ? ['value'] : [])];
  const total = 22 + 60 + cols.reduce((sum, c) => sum + w[c], 0);
  const head = (c: string) => (
    <th data-col={c} class={s.resizable}>
      {HEAD[c]}
      <span class={s.resizer} data-resize="" onMouseDown={(e) => startResize(c, e as MouseEvent)} />
    </th>
  );
  return (
    <table class={s.grid} style={{ width: `${total}px` }}>
      <colgroup>
        <col style={{ width: '22px' }} />
        {COLS.map((c) => (
          <col data-col={c} style={{ width: `${w[c]}px` }} />
        ))}
        <col style={{ width: '60px' }} />
        {ruleOn && <col data-col="rule" style={{ width: `${w.rule}px` }} />}
        {values.value && <col data-col="value" style={{ width: `${w.value}px` }} />}
      </colgroup>
      <thead>
        <tr>
          <th />
          {COLS.map(head)}
          <th />
          {ruleOn && head('rule')}
          {values.value && head('value')}
        </tr>
      </thead>
      <tbody>
        {ruleOn && (
          <tr class={s.row + ' ' + s.sectionRow + ' ' + s.docRow} data-doc-row="">
            <td />
            <td colSpan={COLS.length + 1}>Whole document</td>
            <td data-col="rule">
              <MarkIcons marks={ruleGlobalMarks.value || []} />
            </td>
            {values.value && <td />}
          </tr>
        )}
        {work.value.flatMap((n) => renderNode(n, 0, false, null, show))}
        {!show && (
          <tr class={s.addSectionRow}>
            <td colSpan={cols.length + 2}>
              <button
                type="button"
                class={s.linkBtn}
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
  );
}
