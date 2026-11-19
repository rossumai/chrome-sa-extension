// src/console/components/Rail.tsx
import { h } from 'preact';
import { activeApp, experimentalUnlocked } from '../store.js';
import { visibleApps } from '../apps.jsx';
import FabryMark from '../../ui/FabryMark.jsx';
import styles from './Rail.module.css';

// The rail keeps the shared FabryMark, rendered STATIC (no colour cycle); fill inherits
// the rail's currentColor, incl. white-when-active.
const FABRY_ICON = <FabryMark size={20} animated={false} />;

export default function Rail() {
  const active = activeApp.value;
  const unlocked = experimentalUnlocked.value;
  return (
    <nav class={styles.rail} aria-label="Application switcher">
      {visibleApps(unlocked).map((a) => (
        <button
          type="button"
          class={
            styles.item +
            (active === a.id ? ' ' + styles.active : '') +
            (a.muted ? ' ' + styles.muted : '')
          }
          title={a.title}
          aria-current={active === a.id ? 'page' : undefined}
          onClick={() => {
            activeApp.value = a.id;
          }}
        >
          <span class={styles.icon}>{a.id === 'fabry' ? FABRY_ICON : a.icon}</span>
          <span class={styles.label}>{a.label}</span>
          {a.beta && <span class={styles.beta}>beta</span>}
          {a.exp && <span class={styles.exp}>exp</span>}
        </button>
      ))}
    </nav>
  );
}
