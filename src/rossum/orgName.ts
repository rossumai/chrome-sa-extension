// Pure half of the org name and env (features/org-name.ts is the DOM half): which
// organization the session is in, whether the features are on, and where the pill fits.
// No DOM, no network — the feature measures and fetches, this decides.

// The organization the session is in, from `GET /organizations`. That list holds what
// the session's token can see — the one organization it is in — and it is what the
// Rossum UI reads too. `auth/user`'s `organization` is NOT a substitute: it names the
// user's HOME organization, and for a service or system user that is one the session
// cannot even read (404, measured on a dedicated cell 2026-09-23). More than one
// organization, or none, names nothing: which is current cannot be told, and a wrong
// name is worse than no name.
//
// `sandbox` is `organization.sandbox === true` and nothing else: the flag marks usage
// outside the fair-usage policy, so anything else, a missing flag included, is billed
// as production.
export type Org = {
  name: string;
  id: number | null;
  sandbox: boolean;
  /** Its organization group's API path on this origin, to read the deployment location. */
  groupPath: string | null;
  /** Where the group is deployed (`prod-eu2`); null until read, or when it cannot be. */
  location: string | null;
};

export function currentOrg(list: unknown): Org | null {
  const results = (list as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length !== 1) return null;
  const { name, id, sandbox, organization_group: group } = results[0] ?? {};
  if (typeof name !== 'string' || !name.trim()) return null;
  return {
    name: name.trim(),
    id: typeof id === 'number' ? id : null,
    sandbox: sandbox === true,
    groupPath: groupPathOf(group),
    location: null,
  };
}

// Only the path is kept, and always requested on the page's own origin.
function groupPathOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const { pathname } = new URL(url);
    return /^\/api\/v1\/organization_groups\/\d+$/.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

// A cached organization, as features/org-name.ts keeps it in the tab's sessionStorage:
// `{ at, org }`. The id never changes and the name and cell almost never do, so a page
// reload need not ask again; a day bounds how long a rename goes unseen. Anything else —
// expired, malformed, not ours — reads as no entry.
export const ORG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function cachedOrg(raw: string | null, now: number): Org | null {
  if (!raw) return null;
  let entry: { at?: unknown; org?: Partial<Org> } | null;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  const org = entry?.org;
  if (typeof entry?.at !== 'number' || now - entry.at >= ORG_CACHE_TTL_MS) return null;
  if (!org || typeof org.name !== 'string' || !org.name) return null;
  if (typeof org.sandbox !== 'boolean' || !('id' in org) || !('location' in org)) return null;
  return {
    name: org.name,
    id: typeof org.id === 'number' ? org.id : null,
    sandbox: org.sandbox,
    // It decides where a token-bearing request goes, so it is checked like a fresh one.
    groupPath: groupPathOf(`https://x${org.groupPath ?? ''}`),
    location: typeof org.location === 'string' ? org.location : null,
  };
}

// Where cachedOrg's entry lives in the tab's sessionStorage: a hash of the session token,
// never the token itself — FNV-1a, enough to tell a tab's few tokens apart, synchronous.
export const ORG_CACHE_PREFIX = 'rossum-sa-extension-org:';

export function orgCacheKey(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 0x01000193);
  return `${ORG_CACHE_PREFIX}${(hash >>> 0).toString(16)}`;
}

// The cell the organization group is deployed in, read off the group — every role tried
// (admin, manager, annotator) can read it.
export function deploymentLocation(group: unknown): string | null {
  const location = (group as { deployment_location?: unknown } | null)?.deployment_location;
  return typeof location === 'string' && location ? location : null;
}

// How the organization is named on screen: its name, its id, then its deployment location
// when known — `Acme: 7 [prod-eu2]` in the header, `Acme · org: 7 [prod-eu2]` in the Console.
export const orgLabel = (org: Org, separator = ': '): string =>
  (org.id === null ? org.name : `${org.name}${separator}${org.id}`) +
  (org.location ? ` [${org.location}]` : '');

// The feature's switch, and the ONE place its default lives. It is the one toggle that
// defaults ON: an absent key means enabled and only an explicit `false` disables it.
// Every other toggle reads a missing key as off, so this must never be coerced —
// `!!undefined` hides the name from everyone who has never opened the popup, and shows
// the popup's switch off while the feature runs.
export const ORG_NAME_KEY = 'orgNameEnabled';
export const orgNameOn = (stored: unknown): boolean => stored !== false;

export type Box = { left: number; top: number; right: number; bottom: number };

const GAP = 12;
const MIN_WIDTH = 60;
// Between the environment chip and the name inside the pill.
export const CHIP_GAP = 8;

// The narrowest the pill can be and still be read: a readable name, plus the chip beside
// it (the chip never truncates). Never more than the whole pill, which may be shorter;
// `whole` is 0 when nothing could be measured.
export function pillMinWidth({
  nameShown,
  chipWidth,
  whole,
}: {
  nameShown: boolean;
  chipWidth: number;
  whole: number;
}): number {
  const name = nameShown ? MIN_WIDTH + (chipWidth ? CHIP_GAP : 0) : 0;
  const least = name + chipWidth || MIN_WIDTH;
  return whole > 0 ? Math.min(whole, least) : least;
}

// The pill sits in a free gap of the header, right-aligned against whatever closes that
// gap on the right: the header's right-hand buttons on a plain header (the gap after the
// last nav tab, or after the paging controls on the review screen), or branding such as
// "Powered by Rossum" when a white-labelled header puts it right beside the buttons.
// `obstacles` are the header's visible controls and text; one that reaches into or past
// the buttons is a wrapper or a button itself, not a neighbour, and is ignored.
//
// Which gap: the rightmost one that holds the WHOLE name (`nameWidth`, the pill's
// natural width), searching leftwards from the buttons — a name is better moved than
// cut. Only when no gap holds it all is it truncated, in the rightmost gap still wide
// enough to read a name in. The search never picks a gap that lies in the left half of
// the header, though a long name in a gap that ends right of the middle may reach
// across it. Returns the CSS `right` offset from the header's right edge and the width
// available, or null when no gap is wide enough.
export function pillSlot({
  header,
  clusterLeft,
  obstacles,
  nameWidth = 0,
  minWidth = MIN_WIDTH,
}: {
  header: Box;
  clusterLeft: number;
  obstacles: Box[];
  /** The pill's natural width, the whole name shown; 0 when it could not be measured. */
  nameWidth?: number;
  /** The narrowest the pill can be (pillMinWidth); 60px of readable name by default. */
  minWidth?: number;
}): { right: number; maxWidth: number } | null {
  const blocks = obstacles
    .filter((o) => o.right > o.left && o.bottom > o.top && o.right <= clusterLeft)
    .sort((a, b) => a.left - b.left);
  // Walk the blocks left to right, merging overlaps, and collect the gaps between them.
  const gaps: [start: number, end: number][] = [];
  let cursor = header.left;
  for (const block of blocks) {
    if (block.left > cursor) gaps.push([cursor, block.left]);
    cursor = Math.max(cursor, block.right);
  }
  if (clusterLeft > cursor) gaps.push([cursor, clusterLeft]);
  // Never a gap in the left half: that is the logo, the chips and the tabs, and a
  // name found there reads as part of the navigation rather than as "you are here".
  const middle = (header.left + header.right) / 2;
  const slots = gaps
    .filter(([, end]) => end > middle)
    .map(([start, end]) => ({
      right: header.right - end + GAP,
      maxWidth: end - GAP - (start + GAP),
    }))
    .filter((slot) => slot.maxWidth >= minWidth)
    .reverse(); // rightmost first
  return slots.find((slot) => slot.maxWidth >= nameWidth) ?? slots[0] ?? null;
}
