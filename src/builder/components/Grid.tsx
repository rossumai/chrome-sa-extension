import { h, Fragment } from 'preact';
import { signal, computed } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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
  onlyFabryChanges,
  fabryChangedKeys,
  fieldHooks,
  hookRoleById,
  hookFilterIds,
  hookFieldConfigs,
  validation,
  onlyMessages,
  onlyWarnings,
  warningKeys,
  flashRowKey,
  engineState,
  engineFieldsByName,
  fieldCodeHooks,
  codeView,
  engineMode,
} from '../store.js';
import { visibleKeys, withAncestors } from '../fieldFilter.js';
import { apply, openRuleEditor, openHookEditor, openCodeView, openEnginePanel } from '../index.jsx';
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
import { panelOpen, panelWide } from './panels.js';
import {
  isExtracted,
  engineStatus,
  extractedFields,
  isHiddenCaptured,
  HIDDEN_CAPTURED,
} from '../engine.js';
import { SeedPicker } from './Extraction.jsx';
import { fitColumns, WIDTHS, LABEL_MIN } from './columnFit.js';
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
  const row = tableId ? (lineRow.value[tableId] ?? 0) : 0;
  const msgs = (validation.value?.placed.byField.get(node.id)?.get(row) || []).map((m) => ({
    kind: m.type,
    text: m.content,
    event: 'validation',
  }));
  return (
    <span>
      <MarkIcons marks={msgs} />
      {val === undefined ? <span class={s.dim}>—</span> : <span title={val}>{val}</span>}
    </span>
  );
}

// A count of the rules (or MDH hooks) that use a field: one opens it in the right panel,
// several open a list to pick from. One menu is open at a time across both columns.
const pickMenuFor = signal<string | null>(null);

type PickItem = { id: number; label: string };

function PickCell({
  menuKey,
  action,
  optionAttr,
  items,
  onPick,
  extra,
  hot = false,
}: {
  hot?: boolean;
  menuKey: string;
  action: string;
  optionAttr: string;
  items: PickItem[];
  onPick: (id: number) => void;
  extra?: any;
}) {
  const open = pickMenuFor.value === menuKey;
  const wrap = useRef<HTMLSpanElement>(null);
  // While the list is open, a press anywhere outside it closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Element)) pickMenuFor.value = null;
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  if (!items.length) return <span class={s.rulesWrap}>{extra}</span>;
  return (
    <span class={s.rulesWrap} ref={wrap}>
      <button
        type="button"
        class={s.rulesCount + (hot ? ' ' + s.rulesCountFired : '')}
        data-action={action}
        data-fired={hot ? 'true' : undefined}
        title={items.map((x) => x.label).join('\n')}
        onClick={(e) => {
          e.stopPropagation();
          if (items.length === 1) onPick(items[0].id);
          else pickMenuFor.value = open ? null : menuKey;
        }}
      >
        {items.length}
      </button>
      {extra}
      {open && (
        <div class={s.rulesMenu}>
          {items.map((x) => (
            <button
              type="button"
              {...{ [optionAttr]: String(x.id) }}
              class={s.rulesOption}
              onClick={(e) => {
                e.stopPropagation();
                pickMenuFor.value = null;
                onPick(x.id);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function RulesCell({ fieldId }: { fieldId: string }) {
  const items = (fieldRules.value.get(fieldId) || []).map((x) => ({
    id: x.rule.id,
    label: `${x.rule.name} (${x.rule.id})`,
  }));
  return (
    <PickCell
      menuKey={`rules:${fieldId}`}
      hot={(fieldRules.value.get(fieldId) || []).some((x) =>
        validation.value?.fired.has(x.rule.id),
      )}
      action="field-rules"
      optionAttr="data-rule-option"
      items={items}
      onPick={(id) => openRuleEditor(id)}
      extra={
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
      }
    />
  );
}

function HooksCell({ fieldId }: { fieldId: string }) {
  const items = (fieldHooks.value.get(fieldId) || []).map((x) => ({
    id: x.hook.id,
    label: `${x.hook.name} (${x.hook.id}) · ${x.role === 'in' ? 'matched on' : x.role === 'out' ? 'fills' : 'both'}`,
  }));
  return (
    <PickCell
      menuKey={`hooks:${fieldId}`}
      action="field-hooks"
      optionAttr="data-hook-option"
      items={items}
      onPick={(id) => openHookEditor(id)}
    />
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

// In hook mode: which configuration matches ON this field (in N) or fills it (out N).
// The queue's other hooks whose code or settings mention the field (codeRefs.ts).
function CodeHooksCell({ fieldId }: { fieldId: string }) {
  const items = (fieldCodeHooks.value.get(fieldId) || []).map((x) => ({
    id: x.hook.id,
    label: `${x.hook.name} (${x.hook.id}) · ${[x.inCode && 'code', x.inSettings && 'settings'].filter(Boolean).join(' + ')}`,
  }));
  return (
    <PickCell
      menuKey={`code:${fieldId}`}
      action="field-code-hooks"
      optionAttr="data-code-hook-option"
      items={items}
      onPick={(id) => openCodeView(id, fieldId)}
    />
  );
}

function HookBadges({ fieldId }: { fieldId: string }) {
  const list = hookFieldConfigs.value?.get(fieldId);
  if (!list) return null;
  const marks = list.flatMap((c) =>
    (c.role === 'both' ? ['in', 'out'] : [c.role]).map((role) => ({ role, c })),
  );
  return (
    <span class={s.marks}>
      {marks.map(({ role, c }) => (
        <span
          class={s.ruleBadge + ' ' + (role === 'out' ? s.badgeOut : '')}
          data-mark={role}
          title={`${role === 'in' ? 'Matched on' : 'Filled'} in configuration ${c.index + 1}: ${c.name}`}
        >
          {role} {c.index + 1}
        </span>
      ))}
    </span>
  );
}

// What the engine extracts into this field. Generic engine: its AI fields (rir_field_names).
// Custom engine: the engine field's state (see engine.ts), red when the API would reject it;
// a click opens the engine panel, where the cell becomes the seed picker.
function AiCell({ node }: { node: Node }) {
  const es = engineState.value;
  if (!es || !isExtracted(node)) return null;
  if (es.kind !== 'custom') {
    const names: string[] = Array.isArray(node.rir_field_names) ? node.rir_field_names : [];
    return names.length ? (
      <span class={s.mono} title={names.join(', ')}>
        {names.join(', ')}
      </span>
    ) : (
      <span class={s.dim}>—</span>
    );
  }
  if (!es.engine) return null;
  const rejected = (node.rir_field_names?.length ?? 0) > 0 || node.disable_prediction === true;
  const st = engineStatus(node, engineFieldsByName.value);
  const state = rejected ? 'rejected' : st.state;
  if (engineMode.value && !rejected) {
    return (
      <span class={s.aiPick} data-ai={state} title={`${state}${st.seed ? ` · ${st.seed}` : ''}`}>
        <SeedPicker node={node} />
      </span>
    );
  }
  return (
    <button
      type="button"
      class={s.aiChip + ' ' + s.aiBtn + ' ' + s['ai_' + state]}
      data-ai={state}
      data-action="open-engine"
      title={
        rejected
          ? 'The API rejects this on a custom engine: click to fix it'
          : `${st.seed ? `Seeded from catalog field ${st.seed}` : st.state === 'new' ? 'No engine field yet' : 'Learning: no catalog seed'} · click to edit the engine`
      }
      onClick={(e) => {
        e.stopPropagation();
        openEnginePanel(node.__key);
      }}
    >
      {rejected ? 'fix' : st.state}
    </button>
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
        codeView.value = null; // a row click shows that field, not the hook being read
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
      {on('label') && (
        <td data-col="label" data-full={full}>
          {locked ? (
            String(node.label ?? '')
          ) : (
            <EditableCell
              value={String(node.label ?? '')}
              onCommit={(v) => edit(key, ['label'], v)}
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
      )}
      {on('rules') && (
        <td data-col="rules" class={s.rulesCell}>
          {kind !== 'section' && kind !== 'tuple' && node.id && (
            <RulesCell fieldId={String(node.id)} />
          )}
        </td>
      )}
      {on('matching') && (
        <td data-col="matching" class={s.rulesCell}>
          {kind !== 'section' && kind !== 'tuple' && node.id && (
            <HooksCell fieldId={String(node.id)} />
          )}
        </td>
      )}
      {on('hooks') && (
        <td data-col="hooks" class={s.rulesCell}>
          {kind !== 'section' && kind !== 'tuple' && node.id && (
            <CodeHooksCell fieldId={String(node.id)} />
          )}
        </td>
      )}
      {on('actions') && (
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

// Widths come from columnFit for the grid's measured width. While a right panel is
// open the grid drops the flags (the field inspector has them); a read-only schema (rule or
// hook mode) also drops the grip and the row actions. Source and Type always stay. A wide
// panel leaves only ID and the mode's Rule, MDH or (engine mode) AI column (ID and Label when
// there is none).
const EDITING = ['grip', 'actions'];
const DETAIL = ['flags', 'ai', 'hooks'];
// Engine mode makes room on a 13" screen for the AI column's seed pickers.
const ENGINE_DROPS = ['rules', 'matching'];

const columns = computed(() => {
  const cols = [
    'grip',
    'id',
    'label',
    'source',
    'type',
    ...(engineState.value && engineState.value.kind !== 'none' ? ['ai'] : []),
    'flags',
    'rules',
    'matching',
    'hooks',
    'actions',
    ...(ruleMarks.value ? ['rule'] : []),
    ...(hookRoleById.value ? ['mdh'] : []),
    ...(values.value ? ['value'] : []),
  ].filter(
    (c) =>
      !(panelOpen.value && DETAIL.includes(c) && !(c === 'ai' && engineMode.value)) &&
      !(engineMode.value && ENGINE_DROPS.includes(c)) &&
      !(schemaLocked.value && EDITING.includes(c)),
  );
  if (!(panelOpen.value && panelWide.value)) return cols;
  const modeCol = (c: string) => c === 'rule' || c === 'mdh' || (c === 'ai' && engineMode.value);
  const mode = cols.some(modeCol);
  return cols.filter((c) => c === 'id' || modeCol(c) || (!mode && c === 'label'));
});

function on(col: string): boolean {
  return columns.value.includes(col);
}

const HEAD: Record<string, any> = {
  id: 'ID',
  label: 'Label',
  rules: 'Rules',
  matching: 'Matching',
  hooks: 'Hooks',
  mdh: 'MDH',
  value: 'Value',
  rule: 'Rule',
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
    const mine = withAncestors(work.value, keys);
    show = show ? new Set([...show].filter((k) => mine.has(k))) : mine;
  }
  if (engineMode.value) {
    const keys = new Set(extractedFields(work.value).map((x) => x.node.__key));
    const mine = withAncestors(work.value, keys);
    show = show ? new Set([...show].filter((k) => mine.has(k))) : mine;
  }
  if (onlyWarnings.value) {
    const mine = withAncestors(work.value, warningKeys.value);
    show = show ? new Set([...show].filter((k) => mine.has(k))) : mine;
  }
  if (onlyFabryChanges.value) {
    const mine = withAncestors(work.value, fabryChangedKeys.value);
    show = show ? new Set([...show].filter((k) => mine.has(k))) : mine;
  }
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
      <CellTip />
    </Fragment>
  );
}
