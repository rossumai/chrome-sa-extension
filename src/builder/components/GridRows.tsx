import { h, Fragment } from 'preact';
import { signal, computed } from '@preact/signals';
import {
  work,
  status,
  rowErrors,
  selectedKey,
  values,
  ruleRoleById,
  ruleMarks,
  schemaLocked,
  hookRoleById,
  flashRowKey,
  engineState,
  engineMode,
} from '../store.js';
import { apply, editAttr, closeCodeView } from '../index.jsx';
import {
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
  kids,
  type Node,
} from '../model.js';
import { gridColumns } from '../gridColumns.js';
import { isHiddenCaptured, HIDDEN_CAPTURED } from '../engine.js';
import EditableCell from './EditableCell.jsx';
import {
  Flags,
  SourceCell,
  TypeCell,
  ValueCell,
  MarkIcons,
  HookBadges,
  AiCell,
} from './GridCells.jsx';
import { RulesCell, HooksCell, CodeHooksCell } from './PickCell.jsx';
import { panelOpen, panelWide } from './panels.js';
import s from './Builder.module.css';

// The grid's rows: one per schema node, the add links after a section's or a table's
// fields, and which columns they have.

// The key of a just-added row, whose ID cell opens in edit mode.
const pendingEdit = signal<string | null>(null);

function uniqueId(prefix: string): string {
  const ids = new Set(flatten(work.value).map((r) => r.node.id));
  let i = 1;
  while (ids.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
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

export function addNewSection() {
  const k = nextKey(work.value);
  apply(addSection(work.value, newSection(k, uniqueId('new_section'), 'New section')));
  pendingEdit.value = k;
  selectedKey.value = k;
}

// The columns that count a field's rules, MDH hooks and other hooks.
const PICK_COLS = [
  ['rules', RulesCell],
  ['matching', HooksCell],
  ['hooks', CodeHooksCell],
] as const;

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
  // Hovering a cut-off ID or label shows both in full (see CellTip).
  const full = [node.id, node.label].filter(Boolean).join(' · ');
  const cls = [
    s.row,
    role ? s.ruleHit : '',
    flashRowKey.value === key ? s.rowFlash : '',
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
      onClick={() => {
        closeCodeView(); // a row click shows that field, not the hook being read
        selectedKey.value = key;
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (locked) return;
        const from = e.dataTransfer?.getData('text/plain');
        const t = from ? dropTarget(work.value, from, key) : null;
        if (from && t) apply(move(work.value, from, t.parent, t.index));
      }}
    >
      {on('grip') && (
        <td
          class={s.grip}
          draggable={!locked && !deleted && kind !== 'tuple'}
          onDragStart={(e) => e.dataTransfer?.setData('text/plain', key)}
          title="Drag to reorder"
        >
          {kind === 'tuple' ? '' : '⋮⋮'}
        </td>
      )}
      <td data-col="id" data-full={full} style={{ paddingLeft: `${6 + depth * 16}px` }}>
        {kind === 'section' && <span class={s.caret}>▾ </span>}
        {!deleted && isHiddenCaptured(node) && (
          <span class={s.warnMark} data-warn="hidden-captured" title={HIDDEN_CAPTURED}>
            !
          </span>
        )}
        {locked ? (
          <span class={s.mono}>{String(node.id ?? '')}</span>
        ) : (
          <EditableCell
            mono
            value={String(node.id ?? '')}
            autoEdit={pendingEdit.value === key}
            onCommit={(v) => {
              pendingEdit.value = null;
              editAttr(key, ['id'], v.trim());
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
      {on('label') && (
        <td data-col="label" data-full={full}>
          {locked ? (
            String(node.label ?? '')
          ) : (
            <EditableCell
              value={String(node.label ?? '')}
              onCommit={(v) => editAttr(key, ['label'], v)}
            />
          )}
        </td>
      )}
      {on('source') && <td data-col="source">{dp ? <SourceCell node={node} /> : null}</td>}
      {on('type') && (
        <td data-col="type">
          {dp ? (
            <TypeCell node={node} />
          ) : (
            <span class={s.kind}>
              {kind === 'multivalue' ? 'table' : kind === 'tuple' ? 'row' : ''}
            </span>
          )}
        </td>
      )}
      {on('ai') && (
        <td data-col="ai">
          <AiCell node={node} />
        </td>
      )}
      {on('flags') && (
        <td data-col="flags">
          <Flags node={node} />
        </td>
      )}
      {PICK_COLS.map(
        ([col, Cell]) =>
          on(col) && (
            <td data-col={col} class={s.rulesCell}>
              {kind !== 'section' && kind !== 'tuple' && node.id && (
                <Cell fieldId={String(node.id)} />
              )}
            </td>
          ),
      )}
      {on('actions') && (
        <td class={s.actions}>
          {locked ? null : node.__deleted ? (
            <button
              type="button"
              class="btn-link"
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
              class="icon-btn"
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
      )}
      {on('rule') && (
        <td data-col="rule">
          {role === 'condition' || role === 'both' ? (
            <span class={s.ruleBadge} data-mark="if" title="The rule condition reads this field">
              if
            </span>
          ) : null}
          {kind !== 'section' && (
            <MarkIcons marks={ruleMarks.value?.get(String(node.id ?? '')) || []} />
          )}
        </td>
      )}
      {on('mdh') && (
        <td data-col="mdh">
          {kind !== 'section' && <HookBadges fieldId={String(node.id ?? '')} />}
        </td>
      )}
      {on('value') && (
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
      class="btn-link"
      data-action={action}
      data-parent={parentKey}
      onClick={onClick}
    >
      + {label}
    </button>
  );
  return (
    <tr class={s.addRow}>
      {on('grip') && <td />}
      <td
        colSpan={columns.value.length - (on('grip') ? 1 : 0)}
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

export function renderNode(
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

// The grid's columns for what is open now (see gridColumns).
export const columns = computed(() =>
  gridColumns({
    engine: !!engineState.value && engineState.value.kind !== 'none',
    ruleMode: !!ruleMarks.value,
    hookMode: !!hookRoleById.value,
    engineMode: engineMode.value,
    values: !!values.value,
    panelOpen: panelOpen.value,
    panelWide: panelWide.value,
    locked: schemaLocked.value,
  }),
);

export function on(col: string): boolean {
  return columns.value.includes(col);
}
