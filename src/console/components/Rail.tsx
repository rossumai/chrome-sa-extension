// src/console/components/Rail.tsx
import { h } from 'preact';
import { activeApp, experimentalUnlocked } from '../store.js';
import { visibleApps } from '../apps.jsx';
import FabryMark from '../../ui/FabryMark.jsx';

// The rail keeps the shared FabryMark, rendered STATIC (no colour cycle); fill inherits
// the rail's currentColor, incl. white-when-active.
const FABRY_ICON = <FabryMark size={20} animated={false} />;

export default function Rail() {
  const active = activeApp.value;
  const unlocked = experimentalUnlocked.value;
  return (
    <nav class="app-rail" aria-label="Application switcher">
      {visibleApps(unlocked).map((a) => (
        <button
          type="button"
          class={'app-rail-item' + (active === a.id ? ' active' : '') + (a.muted ? ' muted' : '')}
          title={a.title}
          aria-current={active === a.id ? 'page' : undefined}
          onClick={() => {
            activeApp.value = a.id;
          }}
        >
          <span class="app-rail-icon">{a.id === 'fabry' ? FABRY_ICON : a.icon}</span>
          <span class="app-rail-label">{a.label}</span>
          {a.beta && <span class="app-rail-beta">beta</span>}
          {a.exp && <span class="app-rail-exp">exp</span>}
        </button>
      ))}
    </nav>
  );
}
