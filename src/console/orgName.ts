// The connected organization, by the same rule as the Rossum header (currentOrg), so the
// two can never name different organizations: its name, then ` · org: <id> [<location>]`.
// `get` is an initialised Console API client's GET — its timeout and auth, not a second
// transport. `show` gets the name as soon as it is known and again with the location, so
// the name never waits for the group. Silent by design: a missing name is not worth an
// error bar, and a group that cannot be read only leaves the location out.
import { currentOrg, deploymentLocation, orgLabel } from '../rossum/orgName.js';

export async function resolveOrgLabel(
  get: (path: string) => Promise<unknown>,
  show: (label: string) => void,
): Promise<void> {
  let org;
  try {
    org = currentOrg(await get('/api/v1/organizations'));
  } catch {
    return;
  }
  if (!org) return;
  show(orgLabel(org, ' · org: '));
  if (!org.groupPath) return;
  try {
    const location = deploymentLocation(await get(org.groupPath));
    if (location) show(orgLabel({ ...org, location }, ' · org: '));
  } catch {
    /* named without the location */
  }
}
