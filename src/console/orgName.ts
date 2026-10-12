// The connected organization, by the same rule as the Rossum header (currentOrg), so the
// two can never name different organizations: its name, then ` · org: <id> [<location>]`.
// `get` is an initialised Console API client's GET — its timeout and auth, not a second
// transport. Silent by design: a missing name is not worth an error bar, and a group that
// cannot be read only leaves the location out.
import { currentOrg, deploymentLocation, orgLabel } from '../rossum/orgName.js';

export async function resolveOrgLabel(
  get: (path: string) => Promise<unknown>,
): Promise<string | null> {
  let org;
  try {
    org = currentOrg(await get('/api/v1/organizations'));
  } catch {
    return null;
  }
  if (!org) return null;
  if (org.groupPath) {
    try {
      org = { ...org, location: deploymentLocation(await get(org.groupPath)) };
    } catch {
      /* named without the location */
    }
  }
  return orgLabel(org, ' · org: ');
}
