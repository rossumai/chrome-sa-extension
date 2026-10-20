import { h } from 'preact';

// Builder's icons, in one place so the grid speaks one design language. Shapes are Lucide's
// (https://lucide.dev, ISC), the set the Rossum app's own field icons match: eye, export
// arrow, asterisk. `slashed` strikes an icon through, the way Rossum draws a flag that is off.
const PATHS = {
  eye: (
    <g>
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  export: (
    <g>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </g>
  ),
  asterisk: (
    <g>
      <path d="M12 6v12" />
      <path d="M17.2 9 6.8 15" />
      <path d="m6.8 9 10.4 6" />
    </g>
  ),
  info: (
    <g>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </g>
  ),
  warning: (
    <g>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </g>
  ),
  error: (
    <g>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </g>
  ),
  ban: (
    <g>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </g>
  ),
  mail: (
    <g>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </g>
  ),
};

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 16,
  slashed = false,
}: {
  name: IconName;
  size?: number;
  slashed?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
      {slashed && <path d="m3 3 18 18" />}
    </svg>
  );
}
