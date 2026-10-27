import { h, type ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { fieldRules, fieldHooks, fieldCodeHooks, validation } from '../store.js';
import { openRuleEditor, openHookEditor, openCodeView } from '../index.jsx';
import s from './Builder.module.css';

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
  extra?: ComponentChildren;
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

export function RulesCell({ fieldId }: { fieldId: string }) {
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

export function HooksCell({ fieldId }: { fieldId: string }) {
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

// The queue's other hooks whose code or settings mention the field (codeRefs.ts).
export function CodeHooksCell({ fieldId }: { fieldId: string }) {
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
