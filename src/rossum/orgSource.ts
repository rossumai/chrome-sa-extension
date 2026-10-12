// Loads the organization for the org-name feature and the Console: the organization the
// session is in, then its group's deployment location. `show` gets the organization as
// soon as it is known — the name never waits for the group — and again with the location;
// returning `false` says the answer is no longer wanted (an organization switch), and
// stops the load. `get` is the caller's transport.
//
// With a session token, the result is cached in the tab's sessionStorage for a day
// (orgName.ts cachedOrg / orgCacheKey); the Console passes none and is not cached.
import {
  cachedOrg,
  currentOrg,
  deploymentLocation,
  orgCacheKey,
  ORG_CACHE_PREFIX,
  type Org,
} from './orgName.js';

type Get = (path: string) => Promise<unknown>;

function readCache(key: string): Org | null {
  try {
    return cachedOrg(window.sessionStorage.getItem(key), Date.now());
  } catch {
    return null;
  }
}

// One entry per tab: the current session's. A token switch leaves the old one behind, and
// nothing else would ever remove it.
function writeCache(key: string, value: Org) {
  try {
    for (const old of Object.keys(window.sessionStorage)) {
      if (old.startsWith(ORG_CACHE_PREFIX) && old !== key) window.sessionStorage.removeItem(old);
    }
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), org: value }));
  } catch {
    /* no cache, no harm */
  }
}

export async function loadOrg({
  get,
  cacheToken = null,
  withLocation,
  show,
}: {
  get: Get;
  cacheToken?: string | null;
  withLocation: boolean;
  show: (org: Org) => boolean | void;
}): Promise<void> {
  const key = cacheToken ? orgCacheKey(cacheToken) : null;
  let org = key ? readCache(key) : null;
  // Only an answer from the API is written back: rewriting a cached entry on every reload
  // would restart its day, and a rename would never show in a tab reloaded daily.
  const fresh = !org;
  if (!org) {
    try {
      org = currentOrg(await get('/api/v1/organizations'));
    } catch {
      /* no organization */
    }
  }
  if (!org || show(org) === false) return;
  if (withLocation && !org.location && org.groupPath) {
    let location: string | null = null;
    try {
      location = deploymentLocation(await get(org.groupPath));
    } catch {
      /* named without the location */
    }
    if (location) {
      org = { ...org, location };
      if (show(org) === false) return;
    }
  }
  if (key && fresh) writeCache(key, org);
}
