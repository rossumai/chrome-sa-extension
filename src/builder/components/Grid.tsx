import { h } from 'preact';
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { work, status, rowErrors, selectedKey } from '../store.js';
import { apply } from '../index.jsx';
import {
  setAttr,
  setDeleted,
  addField,
  addSection,
  move,
  dropTarget,
  newDatapoint,
  newSection,
  nextKey,
  flatten,
  type Node,
} from '../model.js';
import EditableCell from './EditableCell.jsx';
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

function addNewSection() {
  const k = nextKey(work.value);
  apply(addSection(work.value, newSection(k, uniqueId('new_section'), 'New section')));
  pendingEdit.value = k;
  selectedKey.value = k;
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label class={s.switch}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class={s.switchTrack} />
    </label>
  );
}

function SourceCell({ node }: { node: Node }) {
  const src = node.ui_configuration?.type;
  if (src !== undefined && !SOURCES.includes(src))
    return <span class={s.readonly}>{String(src)}</span>;
  return (
    <select
      class={s.select}
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

function Row({ node, depth, deleted }: { node: Node; depth: number; deleted: boolean }) {
  const key = node.__key;
  const st = status.value.get(key);
  const errs = rowErrors.value.get(key);
  const kind = node.category;
  const dp = kind === 'datapoint';
  const cls = [
    s.row,
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
      onClick={() => (selectedKey.value = key)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = e.dataTransfer?.getData('text/plain');
        const t = from ? dropTarget(work.value, from, key) : null;
        if (from && t) apply(move(work.value, from, t.parent, t.index));
      }}
    >
      <td
        class={s.grip}
        draggable={!deleted && kind !== 'tuple'}
        onDragStart={(e) => e.dataTransfer?.setData('text/plain', key)}
        title="Drag to reorder"
      >
        {kind === 'tuple' ? '' : '⋮⋮'}
      </td>
      <td data-col="id" style={{ paddingLeft: `${6 + depth * 16}px` }}>
        {kind === 'section' && <span class={s.caret}>▾ </span>}
        <EditableCell
          mono
          value={String(node.id ?? '')}
          autoEdit={pendingEdit.value === key}
          onCommit={(v) => {
            pendingEdit.value = null;
            edit(key, ['id'], v.trim());
          }}
        />
        {errs && (
          <div class={s.rowError}>
            {errs.map((m) => (
              <div>{m}</div>
            ))}
          </div>
        )}
      </td>
      <td data-col="label">
        <EditableCell value={String(node.label ?? '')} onCommit={(v) => edit(key, ['label'], v)} />
      </td>
      <td data-col="type">
        {dp ? (
          <TypeCell node={node} />
        ) : (
          <span class={s.kind}>
            {kind === 'multivalue' ? 'table' : kind === 'tuple' ? 'row' : ''}
          </span>
        )}
      </td>
      <td data-col="source">{dp ? <SourceCell node={node} /> : null}</td>
      <td data-col="flags">
        <span class={s.flags}>
          <span data-col="required" title="Required">
            {dp && (
              <Switch
                checked={!!node.constraints?.required}
                onChange={(v) => edit(key, ['constraints', 'required'], v)}
              />
            )}
          </span>
          <span data-col="visible" title="Visible">
            {(dp || kind === 'multivalue') && (
              <Switch checked={!node.hidden} onChange={(v) => edit(key, ['hidden'], !v)} />
            )}
          </span>
          <span data-col="export" title="Export">
            {dp && (
              <Switch
                checked={node.can_export !== false}
                onChange={(v) => edit(key, ['can_export'], v)}
              />
            )}
          </span>
        </span>
      </td>
      <td class={s.actions}>
        {node.__deleted ? (
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
    </tr>
  );
}

function AddRow({ parentKey, depth, label }: { parentKey: string; depth: number; label: string }) {
  return (
    <tr class={s.addRow}>
      <td />
      <td colSpan={6} style={{ paddingLeft: `${6 + depth * 16}px` }}>
        <button
          type="button"
          class={s.linkBtn}
          data-action="add-field"
          data-parent={parentKey}
          onClick={() => addFieldTo(parentKey)}
        >
          + {label}
        </button>
      </td>
    </tr>
  );
}

function renderNode(node: Node, depth: number, parentDeleted: boolean): any[] {
  const deleted = parentDeleted || !!node.__deleted;
  const out: any[] = [<Row key={node.__key} node={node} depth={depth} deleted={deleted} />];
  for (const c of kids(node)) out.push(...renderNode(c, depth + 1, deleted));
  if (!deleted && node.category === 'section') {
    out.push(
      <AddRow
        key={node.__key + ':add'}
        parentKey={node.__key}
        depth={depth + 1}
        label="Add field"
      />,
    );
  }
  if (!deleted && node.category === 'tuple') {
    out.push(
      <AddRow
        key={node.__key + ':add'}
        parentKey={node.__key}
        depth={depth + 1}
        label="Add column"
      />,
    );
  }
  return out;
}

const WIDTHS_KEY = 'builderColumnWidths';
const RESIZABLE = ['id', 'label', 'type', 'source', 'flags'] as const;
const DEFAULT_WIDTHS: Record<string, number> = {
  id: 220,
  label: 200,
  type: 90,
  source: 110,
  flags: 110,
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
  type: 'Type',
  source: 'Source',
  flags: (
    <span class={s.flags}>
      <span title="Required">Req</span>
      <span title="Visible">Vis</span>
      <span title="Export">Exp</span>
    </span>
  ),
};

export default function Grid() {
  useEffect(loadWidths, []);
  const w = widths.value;
  const total = 22 + 60 + RESIZABLE.reduce((sum, c) => sum + w[c], 0);
  return (
    <table class={s.grid} style={{ width: `${total}px` }}>
      <colgroup>
        <col style={{ width: '22px' }} />
        {RESIZABLE.map((c) => (
          <col data-col={c} style={{ width: `${w[c]}px` }} />
        ))}
        <col style={{ width: '60px' }} />
      </colgroup>
      <thead>
        <tr>
          <th />
          {RESIZABLE.map((c) => (
            <th data-col={c} class={s.resizable}>
              {HEAD[c]}
              <span
                class={s.resizer}
                data-resize=""
                onMouseDown={(e) => startResize(c, e as MouseEvent)}
              />
            </th>
          ))}
          <th />
        </tr>
      </thead>
      <tbody>
        {work.value.flatMap((n) => renderNode(n, 0, false))}
        <tr class={s.addSectionRow}>
          <td colSpan={7}>
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
      </tbody>
    </table>
  );
}
