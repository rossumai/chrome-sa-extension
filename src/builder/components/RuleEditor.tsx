import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import {
  ruleEditor,
  ruleDirty,
  ruleErrors,
  ruleSaving,
  assist,
  assistRev,
  ruleEval,
  annotationId,
  annotationContent,
} from '../store.js';
import {
  updateRuleDraft,
  closeRuleEditor,
  saveRule,
  askRuleAssistant,
  discardRule,
  scheduleRuleEval,
} from '../index.jsx';
import { ACTION_TYPES, ACTION_EVENTS, newAction, withActionType } from '../ruleDraft.js';
import CodeEditor from './CodeEditor.jsx';
import AskFabry from './AskFabry.jsx';
import WideButton from './WideButton.jsx';
import s from './Builder.module.css';

function setAction(i: number, next: any) {
  const ed = ruleEditor.value!;
  updateRuleDraft({ actions: ed.draft.actions.map((a, j) => (j === i ? next : a)) });
}

function setPayload(i: number, key: string, value: unknown) {
  const a = ruleEditor.value!.draft.actions[i];
  setAction(i, { ...a, payload: { ...(a.payload || {}), [key]: value } });
}

// One action. The three UI-facing types get fields; any other type keeps its payload as JSON.
function ActionEditor({ action, i }: { action: any; i: number }) {
  const p = action.payload || {};
  const known = ACTION_TYPES.includes(action.type);
  const anchor = (
    <label class={s.field}>
      <span class={s.fieldLabel}>Field</span>
      <input
        class={s.input + ' ' + s.mono}
        value={p.schema_id ?? ''}
        onInput={(e) => setPayload(i, 'schema_id', (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
  return (
    <div class={s.actionCard}>
      <div class={s.optRow}>
        <select
          class={s.select}
          value={action.type}
          onChange={(e) =>
            setAction(i, withActionType(action, (e.currentTarget as HTMLSelectElement).value))
          }
        >
          {!known && <option value={action.type}>{action.type}</option>}
          {ACTION_TYPES.map((t) => (
            <option value={t}>{t}</option>
          ))}
        </select>
        <select
          class={s.select}
          value={action.event}
          onChange={(e) =>
            setAction(i, { ...action, event: (e.currentTarget as HTMLSelectElement).value })
          }
        >
          {ACTION_EVENTS.map((ev) => (
            <option value={ev}>{ev}</option>
          ))}
        </select>
        <label class={s.checkField} title="Enabled">
          <input
            type="checkbox"
            checked={action.enabled !== false}
            onChange={(e) =>
              setAction(i, { ...action, enabled: (e.currentTarget as HTMLInputElement).checked })
            }
          />
        </label>
        <button
          type="button"
          class={s.iconBtn}
          title="Remove this action"
          onClick={() =>
            updateRuleDraft({ actions: ruleEditor.value!.draft.actions.filter((_, j) => j !== i) })
          }
        >
          ✕
        </button>
      </div>
      {action.type === 'show_message' && (
        <div>
          <label class={s.field}>
            <span class={s.fieldLabel}>Severity</span>
            <select
              class={s.select}
              value={p.type ?? 'error'}
              onChange={(e) => setPayload(i, 'type', (e.currentTarget as HTMLSelectElement).value)}
            >
              {['error', 'warning', 'info'].map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label class={s.field}>
            <span class={s.fieldLabel}>Message</span>
            <input
              class={s.input}
              value={p.content ?? ''}
              onInput={(e) => setPayload(i, 'content', (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {anchor}
        </div>
      )}
      {action.type === 'add_automation_blocker' && (
        <div>
          <label class={s.field}>
            <span class={s.fieldLabel}>Reason</span>
            <input
              class={s.input}
              value={p.content ?? ''}
              onInput={(e) => setPayload(i, 'content', (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {anchor}
        </div>
      )}
      {action.type === 'show_hide_field' && (
        <label class={s.field}>
          <span class={s.fieldLabel}>Fields shown when the rule fires</span>
          <input
            class={s.input + ' ' + s.mono}
            value={(p.schema_ids || []).join(', ')}
            onChange={(e) =>
              setPayload(
                i,
                'schema_ids',
                (e.currentTarget as HTMLInputElement).value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      )}
      {!known && (
        <label class={s.field}>
          <span class={s.fieldLabel}>Payload (JSON)</span>
          <textarea
            key={JSON.stringify(p)}
            class={s.code}
            rows={4}
            defaultValue={JSON.stringify(p, null, 2)}
            onBlur={(e) => {
              try {
                setAction(i, {
                  ...action,
                  payload: JSON.parse((e.currentTarget as HTMLTextAreaElement).value),
                });
              } catch {
                ruleErrors.value = [`Action ${action.id}: the payload is not valid JSON`];
              }
            }}
          />
        </label>
      )}
    </div>
  );
}

// Rule mode's right panel: the open rule's name, condition and actions, with its own Save.
export default function RuleEditor() {
  const ed = ruleEditor.value!;
  const d = ed.draft;
  // Re-evaluate on the picked annotation whenever what the evaluation reads changes.
  const actionsKey = JSON.stringify(d.actions);
  useEffect(scheduleRuleEval, [
    d.trigger_condition,
    actionsKey,
    annotationId.value,
    annotationContent.value,
  ]);
  const ev = ruleEval.value;
  return (
    <aside class={s.inspector} data-panel="rule">
      <div class={s.ruleHead}>
        <h4 class={s.inspTitle}>{ed.ruleId != null ? `Rule (${ed.ruleId})` : 'New rule'}</h4>
        <WideButton />
        <button
          type="button"
          class={s.iconBtn}
          data-action="close-rule"
          title="Close (Esc)"
          onClick={closeRuleEditor}
        >
          ✕
        </button>
      </div>
      <AskFabry
        key={`fabry:${ed.ruleId ?? 'new'}:${ed.fromField ?? ''}`}
        state={assist.value}
        onAsk={askRuleAssistant}
        initial={ed.fromField ? `For ${ed.fromField}: ` : ''}
        placeholder="Describe what the rule should do"
        followupPlaceholder="What should change?"
        doneText="Proposal filled in — review, then Save rule or Discard."
      />
      <label class={s.field}>
        <span class={s.fieldLabel}>Name</span>
        <input
          class={s.input}
          value={d.name}
          onInput={(e) => updateRuleDraft({ name: (e.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <label class={s.field}>
        <span class={s.fieldLabel}>Description</span>
        <input
          class={s.input}
          value={d.description}
          onInput={(e) =>
            updateRuleDraft({ description: (e.currentTarget as HTMLInputElement).value })
          }
        />
      </label>
      <label class={s.checkField}>
        <input
          type="checkbox"
          checked={d.enabled}
          onChange={(e) =>
            updateRuleDraft({ enabled: (e.currentTarget as HTMLInputElement).checked })
          }
        />
        Enabled
      </label>
      <div class={s.field}>
        <span class={s.fieldLabel}>Condition (fires when True)</span>
        <CodeEditor
          key={`rule:${ed.ruleId ?? 'new'}:${assistRev.value}`}
          name="condition"
          value={d.trigger_condition}
          onCommit={(v) => updateRuleDraft({ trigger_condition: v })}
        />
        {ev && (ev.error || ev.errors.length > 0) && (
          <div class={s.warn} data-rule-eval-error="">
            {ev.error
              ? `Could not evaluate on this annotation: ${ev.error}`
              : ev.errors.join(' · ')}
          </div>
        )}
      </div>
      <div class={s.field}>
        <span class={s.fieldLabel}>Actions</span>
        {d.actions.map((a, i) => (
          <ActionEditor key={a.id ?? i} action={a} i={i} />
        ))}
        <button
          type="button"
          class={s.linkBtn}
          onClick={() => updateRuleDraft({ actions: [...d.actions, newAction(d.actions)] })}
        >
          + Action
        </button>
      </div>
      {ruleErrors.value.length > 0 && (
        <div class={s.rowError}>
          {ruleErrors.value.map((m) => (
            <div>{m}</div>
          ))}
        </div>
      )}
      <div class={s.dialogActions}>
        <button type="button" class={s.btn} onClick={closeRuleEditor}>
          Close
        </button>
        <button
          type="button"
          class={s.btn}
          data-action="discard-rule"
          disabled={!ruleDirty.value}
          onClick={discardRule}
        >
          Discard
        </button>
        <button
          type="button"
          class={s.btn + ' ' + s.primary}
          data-action="save-rule"
          disabled={!ruleDirty.value || ruleSaving.value}
          onClick={saveRule}
        >
          {ruleSaving.value ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </aside>
  );
}
