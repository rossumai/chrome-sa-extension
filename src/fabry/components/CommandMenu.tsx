import { h } from 'preact';
import styles from './CommandMenu.module.css';

// Pure popover listing slash commands matching `query` ('' hides nothing).
export default function CommandMenu({
  query,
  commands,
  onPick,
}: {
  query?: string;
  commands?: any[];
  onPick: (cmd: any) => void;
}) {
  const q = (query || '').toLowerCase();
  const hits = (commands || []).filter((c) => c.name.toLowerCase().startsWith(q));
  if (!hits.length) return null;
  return (
    <div class={styles.cmdmenu}>
      {hits.map((c) => (
        <div key={c.name} class="fabry-cmd">
          <button type="button" class={styles.cmdRow} onClick={() => onPick(c.name + ' ')}>
            <span class={styles.cmdName}>{c.name}</span>
            <span class={styles.cmdDesc}>{c.description}</span>
          </button>
          {(c.argument_suggestions || []).map((s: any) => (
            <button
              key={s.value}
              type="button"
              class={styles.cmdArg}
              title={s.description}
              onClick={() => onPick(`${c.name} ${s.value}`)}
            >
              {s.value}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
