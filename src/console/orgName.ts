// The connected organization, by the same rule as the Rossum header (currentOrg), so the
// two can never name different organizations: its name, then ` · org: <id>`. `get` is an
// initialised Console API client's GET — its timeout and auth, not a second transport.
// Silent by design: a missing name is not worth an error bar.
import { currentOrg } from '../rossum/orgName.js';

export async function resolveOrgLabel(
  get: (path: string) => Promise<unknown>,
): Promise<string | null> {
  try {
    const org = currentOrg(await get('/api/v1/organizations'));
    if (!org) return null;
    return org.id === null ? org.name : `${org.name} · org: ${org.id}`;
  } catch {
    return null;
  }
}
