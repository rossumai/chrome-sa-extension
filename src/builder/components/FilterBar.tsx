import { h, Fragment } from 'preact';
import {
  fieldFilter,
  work,
  rules,
  ruleRefs,
  selectedQueueId,
  ruleEditor,
  hooks,
  hookEditor,
  hookLive,
  hookConfigIndex,
  validation,
  onlyMessages,
  onlyWarnings,
  warningKeys,
} from '../store.js';
import { flatten } from '../model.js';
import { countMatches } from '../fieldFilter.js';
import { openRuleEditor, closeRuleEditor, openHookEditor, closeHookEditor } from '../index.jsx';
import { mdhHooks, configSummaries } from '../matching.js';
import { pickHookConfig } from './hookJump.js';
import AnnotationPicker from './AnnotationPicker.jsx';
import SearchPicker from './SearchPicker.jsx';
import FilterInput from '../../ui/FilterInput.jsx';
import s from './Builder.module.css';

// The bar above the grid: its filters — text (id or label), a rule, an MDH hook and one of
// the hook's configurations — and, at the right end, the annotation whose values show.
// Picking a rule or a hook (typing finds it by name or id) opens it in the right panel and
// shows only its fields; the text filter then adds matches.
export default function FilterBar() {
  const editing = ruleEditor.value;
  const msgFields = validation.value?.placed.byField.size ?? 0;
  const hookEd = hookEditor.value;
  const mdh = mdhHooks(hooks.value);
  const configs = hookLive.value ? configSummaries(hookLive.value) : [];
  const matchCount = countMatches(work.value, fieldFilter.value);
  // Fields the picked rule names that this schema does not have: usually a broken rule.
  const refs = ruleRefs.value;
  const ids = new Set(flatten(work.value).map((r) => r.node.id));
  const missing = refs
    ? [...new Set([...refs.condition, ...refs.actions])].filter((x) => !ids.has(x))
    : [];
  return (
    <div class={s.pickBar}>
      {/* Active only when trimmed text is left: the matcher trims (fieldFilter.ts). */}
      <FilterInput
        className={s.fieldFilter}
        value={fieldFilter.value}
        onInput={(v) => (fieldFilter.value = v)}
        onClear={() => (fieldFilter.value = '')}
        active={!!fieldFilter.value.trim()}
        placeholder="Find field by ID or label"
        ariaLabel="Find field by ID or label"
        onKeyDown={(e) => {
          if (e.key === 'Escape') fieldFilter.value = '';
        }}
      />
      {fieldFilter.value.trim() && (
        <span class={s.dim}>
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
        </span>
      )}
      {(warningKeys.value.size > 0 || onlyWarnings.value) && (
        <button
          type="button"
          class={'btn btn-sm ' + s.warnFilter}
          data-action="only-warnings"
          aria-pressed={onlyWarnings.value ? 'true' : 'false'}
          title={
            onlyWarnings.value
              ? 'Show all fields'
              : 'Show only fields with a warning (captured but hidden)'
          }
          onClick={() => (onlyWarnings.value = !onlyWarnings.value)}
        >
          <span class={s.warnMark}>!</span>
          {warningKeys.value.size}
        </button>
      )}
      {validation.value && (
        <label class={s.checkField + ' ' + s.barToggle}>
          <input
            type="checkbox"
            data-action="only-messages"
            checked={onlyMessages.value}
            onChange={(e) => (onlyMessages.value = (e.currentTarget as HTMLInputElement).checked)}
          />
          With messages ({msgFields}) · {validation.value.fired.size} fired
        </label>
      )}
      {selectedQueueId.value != null && (
        <Fragment>
          <span class={s.dim}>Rule</span>
          <SearchPicker
            picker="rule"
            value={editing ? (editing.ruleId != null ? String(editing.ruleId) : 'new') : ''}
            placeholder={rules.value.length ? 'no rule' : 'no rules on this queue'}
            options={[
              ...(editing && editing.ruleId == null
                ? [{ value: 'new', label: 'new rule (unsaved)' }]
                : []),
              ...rules.value.map((r) => ({
                value: String(r.id),
                label:
                  `${r.name} (${r.id})` +
                  (r.enabled === false ? ' · disabled' : '') +
                  (validation.value?.fired.has(r.id) ? ' ● fired' : ''),
              })),
            ]}
            onPick={(v) => {
              if (v !== 'new') openRuleEditor(Number(v));
            }}
          />
          {editing && (
            <button
              type="button"
              class="icon-btn"
              data-action="clear-rule"
              title="Stop filtering by this rule"
              onClick={closeRuleEditor}
            >
              ✕
            </button>
          )}
          {missing.length > 0 && (
            <span
              class={s.warn}
              title="The rule names these fields, but this schema has none of them"
            >
              not in schema: {missing.join(', ')}
            </span>
          )}
        </Fragment>
      )}
      {selectedQueueId.value != null && (
        <Fragment>
          <span class={s.dim}>MDH</span>
          <SearchPicker
            picker="hook"
            value={hookEd ? String(hookEd.hookId) : ''}
            placeholder={mdh.length ? 'no hook' : 'no MDH hooks on this queue'}
            options={mdh.map((x) => ({ value: String(x.id), label: `${x.name} (${x.id})` }))}
            onPick={(v) => openHookEditor(Number(v))}
          />
          {hookEd && (
            <Fragment>
              <select
                class={s.select}
                data-picker="config"
                value={hookConfigIndex.value != null ? String(hookConfigIndex.value) : ''}
                title="Show only the fields one configuration uses, and jump to it in the editor"
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  pickHookConfig(v === '' ? null : Number(v));
                }}
              >
                <option value="">All configurations ({configs.length})</option>
                {configs.map((c) => (
                  <option value={String(c.index)}>
                    {c.index + 1} · {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                class="icon-btn"
                data-action="clear-hook"
                title="Stop filtering by this hook"
                onClick={closeHookEditor}
              >
                ✕
              </button>
            </Fragment>
          )}
        </Fragment>
      )}
      <span class={s.spacer} />
      <AnnotationPicker />
    </div>
  );
}
