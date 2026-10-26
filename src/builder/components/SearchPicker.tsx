import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import s from './Builder.module.css';

export type PickerOption = { value: string; label: string };

// A select you can type into: the list narrows to options whose label (name and "(id)")
// contains the text. ↑/↓ move, Enter picks, Esc leaves; clearing is the caller's ✕ button.
export default function SearchPicker({
  picker,
  value,
  options,
  placeholder,
  onPick,
}: {
  picker: string;
  value: string;
  options: PickerOption[];
  placeholder: string;
  onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState<string | null>(null); // null: closed
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const current = options.find((o) => o.value === value);
  const q = (query ?? '').trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const at = Math.min(active, shown.length - 1);
  const pick = (o: PickerOption) => {
    input.current?.blur();
    if (o.value !== value) onPick(o.value);
  };
  return (
    <span class={s.searchPick} data-picker={picker} data-value={value}>
      <input
        ref={input}
        class={s.input}
        placeholder={placeholder}
        title={current?.label}
        value={query ?? current?.label ?? ''}
        onFocus={(e) => {
          setQuery('');
          setActive(0);
          (e.currentTarget as HTMLInputElement).select();
        }}
        onBlur={() => setQuery(null)}
        onInput={(e) => {
          setQuery((e.currentTarget as HTMLInputElement).value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive(Math.min(at + 1, shown.length - 1));
          else if (e.key === 'ArrowUp') setActive(Math.max(at - 1, 0));
          else if (e.key === 'Enter' && shown[at]) pick(shown[at]);
          else if (e.key === 'Escape') input.current?.blur();
          else return;
          e.preventDefault();
        }}
      />
      {query != null && (
        <div class={s.searchList} role="listbox">
          {shown.length ? (
            shown.map((o, i) => (
              <div
                role="option"
                aria-selected={o.value === value ? 'true' : 'false'}
                data-option={o.value}
                class={s.searchOption + (i === at ? ' ' + s.searchActive : '')}
                // mousedown, not click: a click would blur the input first and close the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o.label}
              </div>
            ))
          ) : (
            <div class={s.searchEmpty}>No match</div>
          )}
        </div>
      )}
    </span>
  );
}
