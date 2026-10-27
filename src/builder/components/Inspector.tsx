import { h, Fragment, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { work, selectedKey, fieldAssist, IDLE_ASSIST } from '../store.js';
import { editAttr, askFieldAssistant } from '../index.jsx';
import { findByKey, type Node } from '../model.js';
import CodeEditor from './CodeEditor.jsx';
import AskFabry from './AskFabry.jsx';
import FieldLinks from './FieldLinks.jsx';
import Extraction from './Extraction.jsx';
import { isHiddenCaptured, HIDDEN_CAPTURED } from '../engine.js';
import PanelHead from './PanelHead.jsx';
import s from './Builder.module.css';

function get(node: Node, path: string[]): any {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), node as any);
}

// Inputs commit on change (blur for text), so one finished edit = one history entry.
function Text({
  node,
  path,
  label,
  multiline,
}: {
  node: Node;
  path: string[];
  label: string;
  multiline?: boolean;
}) {
  const v = get(node, path);
  const commit = (raw: string) => {
    const next = raw === '' ? undefined : raw;
    if (next !== v) editAttr(node.__key, path, next);
  };
  return (
    <label class={s.field}>
      <span class={s.fieldLabel}>{label}</span>
      {multiline ? (
        <textarea
          key={node.__key + path.join('.') + JSON.stringify(v ?? null)}
          class={s.code}
          rows={5}
          defaultValue={v ?? ''}
          onBlur={(e) => commit((e.currentTarget as HTMLTextAreaElement).value)}
        />
      ) : (
        <input
          key={node.__key + path.join('.') + JSON.stringify(v ?? null)}
          class={s.input}
          defaultValue={v ?? ''}
          onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
      )}
    </label>
  );
}

function Num({ node, path, label }: { node: Node; path: string[]; label: string }) {
  const v = get(node, path);
  return (
    <label class={s.field}>
      <span class={s.fieldLabel}>{label}</span>
      <input
        key={node.__key + path.join('.') + JSON.stringify(v ?? null)}
        type="number"
        class={s.input}
        defaultValue={v ?? ''}
        onBlur={(e) => {
          const raw = (e.currentTarget as HTMLInputElement).value;
          const next = raw === '' ? undefined : Number(raw);
          if (next !== v) editAttr(node.__key, path, next);
        }}
      />
    </label>
  );
}

function Bool({ node, path, label }: { node: Node; path: string[]; label: string }) {
  return (
    <label class={s.checkField}>
      <input
        type="checkbox"
        checked={!!get(node, path)}
        onChange={(e) => editAttr(node.__key, path, (e.currentTarget as HTMLInputElement).checked)}
      />
      {label}
    </label>
  );
}

function Pick({
  node,
  path,
  label,
  options,
}: {
  node: Node;
  path: string[];
  label: string;
  options: string[];
}) {
  const v = get(node, path);
  return (
    <label class={s.field}>
      <span class={s.fieldLabel}>{label}</span>
      <select
        class={s.select}
        value={v ?? ''}
        onChange={(e) =>
          editAttr(node.__key, path, (e.currentTarget as HTMLSelectElement).value || undefined)
        }
      >
        <option value="">(not set)</option>
        {options.map((o) => (
          <option value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

// A list of strings edited as comma- or line-separated text.
function List({
  node,
  path,
  label,
  lines,
}: {
  node: Node;
  path: string[];
  label: string;
  lines?: boolean;
}) {
  const v: string[] = Array.isArray(get(node, path)) ? get(node, path) : [];
  const sep = lines ? '\n' : ', ';
  return (
    <label class={s.field}>
      <span class={s.fieldLabel}>{label}</span>
      <textarea
        key={node.__key + path.join('.') + JSON.stringify(v ?? null)}
        class={s.code}
        rows={lines ? 3 : 1}
        defaultValue={v.join(sep)}
        onBlur={(e) => {
          const next = (e.currentTarget as HTMLTextAreaElement).value
            .split(lines ? '\n' : ',')
            .map((x) => x.trim())
            .filter(Boolean);
          if (JSON.stringify(next) !== JSON.stringify(v)) editAttr(node.__key, path, next);
        }}
      />
    </label>
  );
}

function Options({ node }: { node: Node }) {
  const opts: { value: string; label: string }[] = Array.isArray(node.options) ? node.options : [];
  const set = (next: { value: string; label: string }[]) => editAttr(node.__key, ['options'], next);
  const change = (i: number, k: 'value' | 'label', val: string) => {
    if (opts[i][k] === val) return;
    set(opts.map((o, j) => (j === i ? { ...o, [k]: val } : o)));
  };
  const swap = (i: number, j: number) => {
    const next = [...opts];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  return (
    <div class={s.field}>
      <span class={s.fieldLabel}>Options</span>
      {opts.map((o, i) => (
        <div class={s.optRow} key={node.__key + ':' + i + ':' + o.value + ':' + o.label}>
          <input
            class={s.input + ' ' + s.mono}
            defaultValue={o.value}
            placeholder="value"
            onBlur={(e) => change(i, 'value', (e.currentTarget as HTMLInputElement).value)}
          />
          <input
            class={s.input}
            defaultValue={o.label}
            placeholder="label"
            onBlur={(e) => change(i, 'label', (e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="icon-btn"
            disabled={i === 0}
            onClick={() => swap(i, i - 1)}
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            class="icon-btn"
            disabled={i === opts.length - 1}
            onClick={() => swap(i, i + 1)}
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            class="icon-btn"
            onClick={() => set(opts.filter((_, j) => j !== i))}
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        class="btn-link"
        onClick={() =>
          set([...opts, { value: `option_${opts.length + 1}`, label: `Option ${opts.length + 1}` }])
        }
      >
        + Add option
      </button>
    </div>
  );
}

function ReadOnlyJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div class={s.field}>
      <span class={s.fieldLabel}>{label} (read-only)</span>
      <pre class={s.code}>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default function Inspector() {
  const [expanded, setExpanded] = useState(false);
  const key = selectedKey.value;
  useEffect(() => setExpanded(false), [key]); // a new selection starts collapsed
  const node = key ? findByKey(work.value, key) : null;
  const shell = (children: ComponentChildren, fill = false) => (
    <aside
      class={s.inspector + (fill ? ' ' + s.inspectorFill : '')}
      data-expanded={fill ? 'true' : undefined}
      data-panel="field"
    >
      {children}
    </aside>
  );
  // No selection, no panel: it comes in when a row is clicked (see App's click-away).
  if (!node) return null;
  const kind = node.category;
  const src = node.ui_configuration?.type;
  const type = node.type;
  // Mr. Fabry for this field: one chat per field; the answer is one undoable schema edit.
  const fa = fieldAssist.value;
  const askBox = (
    <AskFabry
      key={`fabry:${node.__key}`}
      state={fa.forKey === node.__key ? fa : IDLE_ASSIST}
      onAsk={(text) => askFieldAssistant(node.__key, text)}
      placeholder={
        src === 'formula'
          ? 'Describe what this formula should compute'
          : 'Describe what to change on this field'
      }
      followupPlaceholder="What should change?"
      doneText="Applied as one edit — Undo takes it back."
    />
  );
  // Closing clears the selection, as Esc or a click into empty grid space does.
  const head = (
    <PanelHead
      title={node.id}
      mono
      closeAction="close-field"
      onClose={() => (selectedKey.value = null)}
    />
  );
  const formulaEditor = (fill: boolean) => (
    <div class={s.field + (fill ? ' ' + s.grow : '')}>
      <span class={s.fieldLabel}>Formula</span>
      <CodeEditor
        key={node.__key + ':formula:' + String(node.formula ?? '')}
        name="formula"
        value={String(node.formula ?? '')}
        onCommit={(v) => editAttr(node.__key, ['formula'], v === '' ? undefined : v)}
        expanded={fill}
        onToggleExpand={() => setExpanded(!fill)}
      />
    </div>
  );
  if (expanded && src === 'formula') {
    return shell(
      <Fragment>
        {head}
        {askBox}
        {formulaEditor(true)}
      </Fragment>,
      true,
    );
  }
  return shell(
    <Fragment>
      {head}
      <div class={s.dim}>
        {kind}
        {type ? ` · ${type}` : ''}
        {src ? ` · ${src}` : ''}
      </div>
      {isHiddenCaptured(node) && (
        <div class={s.warn} data-warn="hidden-captured">
          {HIDDEN_CAPTURED}{' '}
          <button
            type="button"
            class="btn-link"
            data-action="show-field"
            onClick={() => editAttr(node.__key, ['hidden'], false)}
          >
            Make it visible
          </button>
        </div>
      )}
      {kind === 'datapoint' && askBox}
      {kind === 'datapoint' && (
        <div key={node.__key}>
          <Text node={node} path={['description']} label="Description" />
          <Pick
            node={node}
            path={['ui_configuration', 'edit']}
            label="Edit mode"
            options={['enabled', 'enabled_without_warning', 'disabled']}
          />
          <Extraction node={node}>
            <List node={node} path={['rir_field_names']} label="AI fields (rir_field_names)" />
          </Extraction>
          <Text node={node} path={['default_value']} label="Default value" />
          <Num node={node} path={['score_threshold']} label="Score threshold" />
          <Num node={node} path={['width']} label="Width" />
          <Bool node={node} path={['disable_prediction']} label="Disable prediction" />
          {type === 'string' && (
            <div>
              <Num node={node} path={['constraints', 'length', 'min']} label="Length min" />
              <Num node={node} path={['constraints', 'length', 'max']} label="Length max" />
              <Num node={node} path={['constraints', 'length', 'exact']} label="Length exact" />
              <Text node={node} path={['constraints', 'regexp', 'pattern']} label="Regexp" />
            </div>
          )}
          {(type === 'number' || type === 'date') && (
            <Text node={node} path={['format']} label="Format" />
          )}
          {type === 'enum' && (
            <div>
              <Options node={node} />
              <Pick
                node={node}
                path={['enum_value_type']}
                label="Enum value type"
                options={['string', 'number', 'date']}
              />
            </div>
          )}
          {type === 'button' && (
            <div>
              <Text node={node} path={['popup_url']} label="Popup URL" />
              <Bool node={node} path={['can_obtain_token']} label="Can obtain token" />
            </div>
          )}
          {src === 'formula' && formulaEditor(false)}
          {src === 'reasoning' && (
            <div>
              <Text node={node} path={['prompt']} label="Prompt" multiline />
              <List node={node} path={['context']} label="Context (one per line)" lines />
            </div>
          )}
          {node.matching !== undefined && <ReadOnlyJson label="Matching" value={node.matching} />}
          {node.aggregations !== undefined && (
            <ReadOnlyJson label="Aggregations" value={node.aggregations} />
          )}
        </div>
      )}
      {kind === 'multivalue' && (
        <div key={node.__key}>
          <Num node={node} path={['min_occurrences']} label="Min rows" />
          <Num node={node} path={['max_occurrences']} label="Max rows" />
        </div>
      )}
      {node.id && kind !== 'section' && kind !== 'tuple' && (
        <FieldLinks fieldId={String(node.id)} />
      )}
    </Fragment>,
  );
}
