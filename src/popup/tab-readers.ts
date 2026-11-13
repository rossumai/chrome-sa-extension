// Functions executed in the target tab's main world via runInTab. They run
// inside the page, NOT the popup, so they may only reference `window` and
// their own arguments — no closures over popup-side variables.

export function readAuthInfo() {
  return {
    token: window.localStorage.getItem('secureToken'),
    domain: window.location.origin,
  };
}

export function readCurrentContext() {
  const path = window.location.pathname;
  // DELIBERATE DUPLICATE of src/rossum/annotationUrl.js: this function is
  // serialized and injected into the page, so it cannot close over an import.
  // If the annotation-URL grammar changes there, change it here too.
  const docMatch = path.match(/\/document\/(\d+)/) || path.match(/\/annotations?\/(\d+)/);
  const queueMatch = path.match(/\/queues?\/(\d+)/);
  return {
    token: window.localStorage.getItem('secureToken'),
    domain: window.location.origin,
    annotationId: docMatch ? docMatch[1] : null,
    queueId: queueMatch ? queueMatch[1] : null,
  };
}

// The org-name feature's cached organization for this tab's CURRENT session: the entry
// keyed by a hash of today's token (src/rossum/orgName.ts orgCacheKey). Another token's
// entry is not this session's org — one survives an org switch whose new load failed.
// Returns the raw entry; the popup parses it with cachedOrg. `prefix` is an argument, and
// the hash a DELIBERATE COPY of orgCacheKey's FNV-1a, because this function is serialized
// into the page and cannot import. If the key changes there, change it here too.
export function readOrgCache(prefix: string): string | null {
  const token = window.localStorage.getItem('secureToken');
  if (!token) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 0x01000193);
  return window.sessionStorage.getItem(`${prefix}${(hash >>> 0).toString(16)}`);
}

export function readPageFlag(key: string): boolean {
  return window.localStorage.getItem(key) === 'true';
}

// Returns the flag's NEW value (not a bare `true`): the popup needs the
// authoritative direction, and its cached copy can still be un-filled while the
// first readPageFlag round-trip is in flight.
export function togglePageFlag(key: string): boolean {
  if (window.localStorage.getItem(key) === 'true') {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, 'true');
  }
  return window.localStorage.getItem(key) === 'true';
}
