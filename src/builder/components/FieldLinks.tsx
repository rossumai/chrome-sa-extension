import { h } from 'preact';
import { fieldRules, fieldHooks, fieldCodeHooks, validation } from '../store.js';
import { openRuleEditor, openCodeView } from '../index.jsx';
import { fieldConfigs } from '../matching.js';
import { openHookAtConfig } from './hookJump.js';
import s from './Builder.module.css';

const RULE_ROLE = { condition: 'if', action: 'action', both: 'if + action' } as const;

// The field panel's "Used by": every rule and MDH configuration that uses this field, listed
// in full. A click opens the rule, or the hook scrolled to that configuration.
export default function FieldLinks({ fieldId }: { fieldId: string }) {
  const rules = fieldRules.value.get(fieldId) || [];
  const hooks = fieldHooks.value.get(fieldId) || [];
  const code = fieldCodeHooks.value.get(fieldId) || [];
  return (
    <div class={s.field} data-field-links="">
      <div class={s.linksHead}>
        <span class={s.fieldLabel}>Rules ({rules.length})</span>
        <button
          type="button"
          class={s.linkBtn}
          data-action="new-rule-for-field"
          onClick={() => openRuleEditor(null, fieldId)}
        >
          + New rule
        </button>
      </div>
      {rules.map(({ rule, role }) => (
        <button
          type="button"
          class={s.linkRow}
          data-action="open-field-rule"
          data-rule={String(rule.id)}
          onClick={() => openRuleEditor(rule.id)}
        >
          <span class={s.linkName}>
            {rule.name} ({rule.id})
          </span>
          <span class={s.ruleBadge}>{RULE_ROLE[role]}</span>
          {rule.enabled === false && <span class={s.dim}>disabled</span>}
          {validation.value?.fired.has(rule.id) && <span class={s.warn}>● fired</span>}
        </button>
      ))}
      <div class={s.linksHead}>
        <span class={s.fieldLabel}>MDH hooks ({hooks.length})</span>
      </div>
      {hooks.map(({ hook }) => (
        <div class={s.linkGroup} data-hook={String(hook.id)}>
          <div class={s.linkName}>
            {hook.name} ({hook.id})
          </div>
          {(fieldConfigs(hook).get(fieldId) || []).map((c) => (
            <button
              type="button"
              class={s.linkRow}
              data-action="open-field-config"
              data-config={String(c.index)}
              onClick={() => openHookAtConfig(hook.id, c.index)}
            >
              <span class={s.linkName}>
                {c.index + 1} · {c.name}
              </span>
              {(c.role === 'both' ? ['in', 'out'] : [c.role]).map((r) => (
                <span class={s.ruleBadge + (r === 'out' ? ' ' + s.badgeOut : '')}>{r}</span>
              ))}
            </button>
          ))}
        </div>
      ))}
      <div class={s.linksHead}>
        <span class={s.fieldLabel}>Other hooks ({code.length})</span>
      </div>
      {code.map(({ hook, inCode, inSettings }) => (
        <button
          type="button"
          class={s.linkRow}
          data-action="open-field-code-hook"
          data-hook={String(hook.id)}
          onClick={() => openCodeView(hook.id, fieldId)}
        >
          <span class={s.linkName}>
            {hook.name} ({hook.id})
          </span>
          {inCode && <span class={s.ruleBadge}>code</span>}
          {inSettings && <span class={s.ruleBadge}>settings</span>}
        </button>
      ))}
    </div>
  );
}
