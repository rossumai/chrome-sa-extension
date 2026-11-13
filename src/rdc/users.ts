// The target org's users, for the hooks' token-owner picker. `GET /users` with the session token,
// every page; active users only, each by its API URL (what `token_owner` holds).
import { rateLimitError } from '../net/rateLimit.js';

export type OrgUser = { url: string; label: string };
export type FetchUsers = (domain: string, token: string) => Promise<OrgUser[]>;

export function userLabel(u: any): string {
  const name = [u?.first_name, u?.last_name].filter((x) => typeof x === 'string' && x).join(' ');
  const handle = typeof u?.email === 'string' && u.email ? u.email : u?.username;
  return name && handle ? `${name} (${handle})` : name || String(handle ?? u?.url ?? '');
}

export const fetchUsers: FetchUsers = async (domain, token) => {
  const out: OrgUser[] = [];
  let next: string | null = `${domain}/api/v1/users?is_active=true&page_size=100`;
  while (next) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) throw rateLimitError(res, 'HTTP 429');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page: any = await res.json();
    for (const u of page?.results ?? [])
      if (typeof u?.url === 'string' && u.is_active !== false)
        out.push({ url: u.url, label: userLabel(u) });
    next = typeof page?.pagination?.next === 'string' ? page.pagination.next : null;
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
};
