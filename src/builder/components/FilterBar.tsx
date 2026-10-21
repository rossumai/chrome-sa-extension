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
} from '../store.js';
import { flatten } from '../model.js';
import { countMatches } from '../fieldFilter.js';
import { openRuleEditor, closeRuleEditor, openHookEditor, closeHookEditor } from '../index.jsx';
import { mdhHooks, configSummaries } from '../matching.js';
import { pickHookConfig } from './hookJump.js';
import s from './Builder.module.css';

// The bar above the grid: its filters — text (id or label), a rule, an MDH hook and one of
// the hook's configurations. Picking a rule or a hook opens it in the right panel and shows
// only its fields; the text filter then adds matches.
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
      <input
        class={s.input + ' ' + s.fieldFilter}
        data-filter="fields"
        placeholder="Find field by ID or label"
        value={fieldFilter.value}
        onInput={(e) => (fieldFilter.value = (e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') fieldFilter.value = '';
        }}
      />
      {fieldFilter.value.trim() && (
        <span class={s.dim}>
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
        </span>
      )}
      {validation.value && (
        <label class={s.checkField + ' ' + s.barToggle}>
          <input
            type="checkbox"
            data-action="only-messages"
            checked={onlyMessages.value}
            onChange={(e) => (onlyMessages.value = (e.currentTarget as HTMLInputElement).checked)}
          />
          Only fields with messages ({msgFields}) · {validation.value.fired.size} rule
          {validation.value.fired.size === 1 ? '' : 's'} fired
        </label>
      )}
      {selectedQueueId.value != null && (
        <Fragment>
          <span class={s.dim}>Rule</span>
          <select
            class={s.select}
            data-picker="rule"
            value={editing ? (editing.ruleId != null ? String(editing.ruleId) : 'new') : ''}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v && v !== 'new') openRuleEditor(Number(v));
              else if (!v) closeRuleEditor();
            }}
          >
            <option value="">{rules.value.length ? 'no rule' : 'no rules on this queue'}</option>
            {editing && editing.ruleId == null && <option value="new">new rule (unsaved)</option>}
            {rules.value.map((r) => (
              <option value={String(r.id)}>
                {r.name} ({r.id}){r.enabled === false ? ' · disabled' : ''}
                {validation.value?.fired.has(r.id) ? ' ● fired' : ''}
              </option>
            ))}
          </select>
          {editing && (
            <button
              type="button"
              class={s.iconBtn}
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
          <span class={s.dim}>MDH hook</span>
          <select
            class={s.select}
            data-picker="hook"
            value={hookEd ? String(hookEd.hookId) : ''}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v) openHookEditor(Number(v));
              else closeHookEditor();
            }}
          >
            <option value="">{mdh.length ? 'no hook' : 'no MDH hooks on this queue'}</option>
            {mdh.map((x) => (
              <option value={String(x.id)}>
                {x.name} ({x.id})
              </option>
            ))}
          </select>
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
                class={s.iconBtn}
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
    </div>
  );
}
