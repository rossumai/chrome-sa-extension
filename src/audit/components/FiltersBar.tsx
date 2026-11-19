import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { activeSource, filtersBySource, patchFilters } from '../store.js';
import { SOURCES } from '../sources/index.js';
import ctl from '../../ui/controls.module.css';
import inp from '../../ui/Input.module.css';
import styles from './FiltersBar.module.css';

function DebouncedInput({
  value,
  type,
  placeholder,
  onCommit,
}: {
  value?: string;
  type?: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => {
    setV(value);
  }, [value]); // re-sync on external change (Clear / source switch)
  useEffect(() => {
    const id = setTimeout(() => {
      if (v !== value) onCommit(v as string);
    }, 300);
    return () => clearTimeout(id);
  }, [v]);
  return (
    <input
      class={inp.input}
      // Preact 11 types <input> as one ARIA variant per input type, which a
      // union-valued `type` cannot match; the value is always a real input type.
      type={type as any}
      placeholder={placeholder || ''}
      value={v}
      onInput={(e: any) => setV(e.target.value)}
    />
  );
}

export default function FiltersBar() {
  const key = activeSource.value;
  const desc = SOURCES[key];
  const st = filtersBySource.value[key];

  // Any structured filter change resets paging (page=1, cursor=null). Changing
  // object_type also clears action (its options depend on the type).
  const setFilter = (name: any, value: any) => {
    const patch: Record<string, unknown> = { [name]: value, page: 1, cursor: null };
    if (name === 'object_type') patch.action = '';
    patchFilters(key, patch);
  };

  // Reset the narrowing search filters to empty, preserving the required scope
  // (object_type) — the API requires it. Also resets paging + server search.
  const clearFilters = () => {
    const cleared: Record<string, unknown> = { page: 1, cursor: null, search: '' };
    for (const f of desc.filters) {
      if (f.required) continue;
      cleared[f.name] = '';
    }
    patchFilters(key, cleared);
  };
  const hasActiveFilters = desc.filters.some((f: any) => !f.required && st[f.name]) || !!st.search;

  return (
    <section class={styles.root}>
      <div class={styles.row}>
        {desc.filters.map((f: any) => (
          <label class={styles.filter}>
            <span class={styles.label}>{f.label}</span>
            {f.kind === 'select' ? (
              <select
                class={inp.input}
                value={st[f.name] as string}
                onChange={(e: any) => setFilter(f.name, e.target.value)}
              >
                {!f.required && <option value="">any</option>}
                {(f.options ? f.options(st) : []).map((o: any) => (
                  <option value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <DebouncedInput
                type={
                  f.kind === 'number' ? 'number' : f.kind === 'datetime' ? 'datetime-local' : 'text'
                }
                placeholder={f.placeholder || ''}
                value={st[f.name] as string}
                onCommit={(val: string) => setFilter(f.name, val)}
              />
            )}
          </label>
        ))}

        {desc.supportsServerSearch && (
          <label class={`${styles.filter} ${styles.grow}`}>
            <span class={styles.label}>Search</span>
            <DebouncedInput
              type="search"
              value={st.search}
              onCommit={(val) => patchFilters(key, { search: val, page: 1, cursor: null })}
            />
          </label>
        )}

        <div class={styles.actions}>
          <button
            class={`${ctl.btn} ${ctl.btnSecondary}`}
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Reset filters
          </button>
        </div>
      </div>
    </section>
  );
}
