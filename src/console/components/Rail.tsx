// src/console/components/Rail.tsx
import { h } from 'preact';
import { activeApp, experimentalUnlocked } from '../store.js';
import type { AppId } from '../boot.js';
import FabryMark from '../../ui/FabryMark.jsx';

const DATA_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
  </svg>
);

const AUDIT_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const HAMMER_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
  </svg>
);

const GALAXY_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="2.2" />
    <ellipse cx="12" cy="12" rx="10" ry="4.3" />
    <ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(120 12 12)" />
  </svg>
);

const INSPECTOR_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// The rail Fabry icon is the shared mark, rendered STATIC (no color cycle) at rail
// size; fill inherits the rail's currentColor (incl. white-when-active).
const FABRY_ICON = <FabryMark size={20} animated={false} />;

const CIB_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 2 3 7l9 5 9-5-9-5z" />
    <path d="M3 12l9 5 9-5" />
    <path d="M3 17l9 5 9-5" />
  </svg>
);

const ACADEMY_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 3 2 8l10 5 10-5-10-5z" />
    <path d="M6 10.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5" />
  </svg>
);

const RDC_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="1 4 1 10 7 10" />
    <polyline points="23 20 23 14 17 14" />
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
  </svg>
);

type RailApp = {
  id: AppId;
  label: string;
  title: string;
  icon: any;
  beta?: boolean;
  exp?: boolean;
  gated?: boolean;
  muted?: boolean;
};

const APPS: RailApp[] = [
  { id: 'mdh', label: 'Data', title: 'Dataset Management', icon: DATA_ICON },
  { id: 'audit', label: 'Audit', title: 'Audit Log Viewer', icon: AUDIT_ICON },
  {
    id: 'cib',
    label: 'CIB',
    title: 'CIB deploy (Coupa Integration Baseline)',
    icon: CIB_ICON,
    beta: true,
  },
  { id: 'builder', label: 'Builder', title: 'Schema Builder', icon: HAMMER_ICON, beta: true },
  {
    id: 'inspector',
    label: 'Inspector',
    title: 'Annotation Inspector',
    icon: INSPECTOR_ICON,
    beta: true,
  },
  { id: 'fabry', label: 'Fabry', title: 'Mr. Fabry', icon: FABRY_ICON, beta: true },
  { id: 'galaxy', label: 'Galaxy', title: 'Org Galaxy', icon: GALAXY_ICON },
  // `gated` hides the row unless experimentalUnlocked is set; `exp` is the
  // badge that names that gate. The title spells the abbreviation out, since
  // "EXP" alone does not tell a first-time reader what it means.
  {
    id: 'academy',
    label: 'Academy',
    title: 'Onboarding training — experimental',
    icon: ACADEMY_ICON,
    exp: true,
    gated: true,
  },
  {
    id: 'rdc',
    label: 'rdc',
    title: 'rdc in the browser (proof of concept) — experimental',
    icon: RDC_ICON,
    exp: true,
    gated: true,
  },
];

export default function Rail() {
  const active = activeApp.value;
  const unlocked = experimentalUnlocked.value;
  return (
    <nav class="app-rail" aria-label="Application switcher">
      {APPS.filter((a) => !a.gated || unlocked).map((a) => (
        <button
          type="button"
          class={'app-rail-item' + (active === a.id ? ' active' : '') + (a.muted ? ' muted' : '')}
          title={a.title}
          aria-current={active === a.id ? 'page' : undefined}
          onClick={() => {
            activeApp.value = a.id;
          }}
        >
          <span class="app-rail-icon">{a.icon}</span>
          <span class="app-rail-label">{a.label}</span>
          {a.beta && <span class="app-rail-beta">beta</span>}
          {a.exp && <span class="app-rail-exp">exp</span>}
        </button>
      ))}
    </nav>
  );
}
