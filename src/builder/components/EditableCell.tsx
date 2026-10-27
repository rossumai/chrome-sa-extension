import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import s from './Builder.module.css';

// Click to edit; Enter or blur commits, Esc cancels. A committed edit calls onCommit
// once, and only when the text changed — one user action, one history entry.
export default function EditableCell({
  value,
  onCommit,
  mono,
  autoEdit,
}: {
  value: string;
  onCommit: (v: string) => void;
  mono?: boolean;
  autoEdit?: boolean;
}) {
  const [editing, setEditing] = useState(!!autoEdit);
  const done = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (v !== null && v !== value) onCommit(v);
  };

  if (!editing) {
    return (
      <span
        class={(mono ? s.mono + ' ' : '') + s.editable}
        data-edit=""
        onClick={(e) => {
          e.stopPropagation();
          done.current = false;
          setEditing(true);
        }}
      >
        {value || <span class={s.dim}>—</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      class={(mono ? s.mono + ' ' : '') + s.cellInput}
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish((e.currentTarget as HTMLInputElement).value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish((e.currentTarget as HTMLInputElement).value)}
    />
  );
}
