// src/console/boot.ts
// Pure helpers for the console shell boot. Kept side-effect-free so they can be
// unit-tested without chrome / DOM / sessionStorage.

/** The nine apps on the rail. Adding one touches this, Rail.jsx and Console.jsx. */
export type AppId =
  'mdh' | 'audit' | 'builder' | 'galaxy' | 'inspector' | 'fabry' | 'cib' | 'academy' | 'rdc';

export function isValidApp(v: unknown): v is AppId {
  return (
    v === 'mdh' ||
    v === 'audit' ||
    v === 'builder' ||
    v === 'galaxy' ||
    v === 'inspector' ||
    v === 'fabry' ||
    v === 'cib' ||
    v === 'academy' ||
    v === 'rdc'
  );
}

// The apps behind the experimental gate (`gated: true` in Rail.tsx): the Builder, the Academy
// and the rdc proof of concept. Everything else, Mr. Fabry included, is always available.
const GATED_APPS: readonly AppId[] = ['builder', 'academy', 'rdc'];

function isGatedApp(app: AppId): boolean {
  return GATED_APPS.includes(app);
}

// Which app to show on boot. Precedence: staging entry (a popup button click)
// wins, then the persisted last-used app, then Dataset Management. A gated app
// is only picked when unlocked. `unlocked` defaults to locked so a caller that
// forgets the flag hides the gated apps rather than revealing them.
export function pickInitialApp({
  stagingApp,
  persistedApp,
  unlocked = false,
}: { stagingApp?: unknown; persistedApp?: unknown; unlocked?: boolean } = {}): AppId {
  const ok = (v: unknown): v is AppId => isValidApp(v) && (!isGatedApp(v) || unlocked);
  if (ok(stagingApp)) return stagingApp;
  if (ok(persistedApp)) return persistedApp;
  return 'mdh';
}

// Re-locking the gate while a gated app is active falls back to Dataset
// Management; every other app is unaffected.
export function appAfterGateChange(activeApp: AppId, unlocked: boolean): AppId {
  if (isGatedApp(activeApp) && !unlocked) return 'mdh';
  return activeApp;
}

// Resolve token/domain from a single-use staging entry (initial open) or the
// session fallback (same-tab reload). When an entry is present it is single-use
// (consumeKey === true) and carries the initial app + DS pipeline prefill.
/** The single-use consoleAuth_<uuid> staging entry, as written by the popup or worker. */
export type StagingEntry = {
  token?: string;
  domain?: string;
  app?: string;
  createdAt?: number;
  pendingCollection?: string;
  pendingPipeline?: string;
  pendingVariables?: unknown;
  pendingVariableTypes?: unknown;
};

export function resolveBootAuth({
  entry,
  session,
}: {
  entry?: StagingEntry | null;
  session: { token?: string | null; domain?: string | null };
}) {
  if (entry?.token && entry?.domain) {
    return {
      token: entry.token,
      domain: entry.domain,
      stagingApp: entry.app,
      consumeKey: true,
      pendingCtx: {
        pendingCollection: entry.pendingCollection,
        pendingPipeline: entry.pendingPipeline,
        pendingVariables: entry.pendingVariables,
        pendingVariableTypes: entry.pendingVariableTypes,
      },
    };
  }
  return {
    token: session.token,
    domain: session.domain,
    stagingApp: undefined,
    consumeKey: false,
    pendingCtx: {},
  };
}

// Keys to purge from chrome.storage.local: stale (or malformed) consoleAuth_
// staging entries past the TTL, plus any orphaned keys left by pre-console
// builds (mdhAuth_/auditAuth_ staging, and mdhToken/mdhDomain at-rest creds).
export function computeStaleAuthRemovals(
  all: Record<string, { createdAt?: unknown } | unknown>,
  now: number,
  ttl: number,
): string[] {
  const toRemove: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('consoleAuth_')) {
      const createdAt = (value as { createdAt?: unknown })?.createdAt;
      if (typeof createdAt !== 'number' || now - createdAt > ttl) toRemove.push(key);
    } else if (
      key.startsWith('mdhAuth_') ||
      key.startsWith('auditAuth_') ||
      key === 'mdhToken' ||
      key === 'mdhDomain'
    ) {
      toRemove.push(key);
    }
  }
  return toRemove;
}
