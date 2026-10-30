// src/cib/components/OwnerCombobox.tsx
// The token owner as ONE search-and-pick field. The typed text (query) and the picked owner's label
// are separate: a pick never becomes a search, and typing after a pick is a new search, which the
// parent answers by clearing the owner. While the field has focus it shows what the user typed, so
// a single match being auto-picked by the parent never rewrites the text under the cursor.
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import styles from './App.module.css';

export type Owner = { username: string; name: string; email: string };

export const ownerLabel = (o: Owner) => (o.name ? `${o.username} · ${o.name}` : o.username);

const initials = (o: Owner) =>
  (o.name || o.username)
    .split(/[\s._-]+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

const LIST_ID = 'cib-owner-list';

export default function OwnerCombobox({
  query,
  owner,
  label,
  owners,
  orgId,
  onQuery,
  onPick,
}: {
  query: string;
  owner: string;
  label: string;
  owners: Owner[];
  orgId: string;
  onQuery: (q: string) => void;
  onPick: (o: Owner) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLInputElement>(null);
  // the old owner <select> was `required`; the form's own validation still refuses a submit
  // without a picked owner, whatever text is typed
  useEffect(() => {
    ref.current?.setCustomValidity(owner ? '' : 'Select an admin from the list.');
  }, [owner]);

  const pick = (o: Owner, input: HTMLInputElement | null) => {
    onPick(o);
    setOpen(false);
    setActive(-1);
    input?.blur();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (owners.length ? (i + step + owners.length) % owners.length : -1));
    } else if (e.key === 'Enter' && open && owners[active]) {
      e.preventDefault();
      pick(owners[active], input);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div class={styles.field}>
      <label class={styles.label} for="cib-owner">
        Token owner
      </label>
      <div class={styles.inputWrap}>
        <svg
          class={styles.lead}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          id="cib-owner"
          ref={ref}
          class={`input ${styles.input} ${styles.hasLead}`}
          role="combobox"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${LIST_ID}-${active}` : undefined}
          autocomplete="off"
          placeholder="Search admins by name or email"
          value={focused || !owner ? query : label}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
          }}
          onInput={(e) => {
            onQuery((e.currentTarget as HTMLInputElement).value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <div class={styles.comboList} id={LIST_ID} role="listbox">
          {owners.length ? (
            owners.map((o, i) => (
              <div
                id={`${LIST_ID}-${i}`}
                role="option"
                aria-selected={i === active || o.username === owner ? 'true' : 'false'}
                class={`${styles.comboOpt} ${i === active ? styles.comboActive : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o, document.getElementById('cib-owner') as HTMLInputElement | null);
                }}
              >
                <span class={styles.avatar}>{initials(o)}</span>
                <span>
                  <span class={styles.comboUser}>{o.username}</span>
                  <span class={styles.comboName}>
                    {[o.name, o.email].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <div class={styles.comboEmpty}>
              No active admin matches. The hooks need an admin of this organization.
            </div>
          )}
          <div class={styles.comboFoot}>Up to 10 matches. Type to narrow.</div>
        </div>
      )}
      <span class={styles.hint}>
        The CIB hooks run as this user. Only active admins of organization {orgId} are listed.
      </span>
    </div>
  );
}
