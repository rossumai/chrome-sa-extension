// Step 4: what Write will send to the target, from rdc's dry-run plan of the target sync after
// the migrate (`Plan.tsx`): created, updated and deleted objects, the ones both sides changed,
// what is read back, and the creates an earlier deployment left to finish. The objects also
// changed directly in the target since the last deployment come first, as a warning: rdc's base
// already holds those edits, so the write overwrites them without a conflict (design §5). There
// is no per-object choice (owner, 2026-11-03). rdc's own log of the dry run stays readable below.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { tokenOwnerMissing, writeList, type Planned } from '../plan.js';
import type { OrgUser } from '../users.js';
import type { PlanItem } from '../wasm.js';
import { LogLine } from './Log.jsx';
import styles from './Deploy.module.css';

type Props = {
  planned: Planned;
  // Direct edits this deployment overwrites (`overwrittenEdits`).
  overwritten: string[];
  sourceName: string;
  targetName: string;
  // The hooks' token owner: the chosen (or stored) target user's URL, or null.
  tokenOwner: string | null;
  onTokenOwner: (userUrl: string) => void;
  // The plan is being made again with a new token owner.
  replanning: boolean;
  // Why planning again failed, or empty.
  replanError?: string;
  // The target org's users, for the picker.
  loadUsers: () => Promise<OrgUser[]>;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
};

const name = (i: { kind: string; slug: string }) => `${i.kind}/${i.slug}`;

function Group(p: { title: string; items: PlanItem[]; hint?: string }) {
  if (!p.items.length) return null;
  return (
    <div aria-label={p.title}>
      <div class={styles.gh}>
        {p.title} ({p.items.length})
      </div>
      {p.hint && <p class={styles.muted}>{p.hint}</p>}
      <ul class={styles.counts}>
        {p.items.map((i) => (
          <li>
            {name(i)}
            {i.note ? ` (${i.note})` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Which target user owns the hooks' tokens: asked only when the plan creates a store-extension
// hook (rdc's install refuses one without an owner), or when an owner is already stored, so the
// admin can change it. The choice goes into the target's overlay and the plan is made again.
function TokenOwner(p: Props) {
  const needed = p.planned.storeHooks.length > 0;
  const [users, setUsers] = useState<OrgUser[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!needed && !p.tokenOwner) return;
    p.loadUsers().then(setUsers, (e) => setError(String((e as Error)?.message || e)));
  }, []);
  if (!needed && !p.tokenOwner) return null;
  const known = users?.some((u) => u.url === p.tokenOwner);
  return (
    <div class={styles.decide} aria-label="Token owner">
      <div class={styles.q}>Which {p.targetName} user owns the hooks' tokens?</div>
      {needed && (
        <p class={styles.muted}>
          {p.targetName} needs one to create{' '}
          {p.planned.storeHooks.map((h) => `hooks/${h}`).join(', ')}. It is written to{' '}
          {p.targetName}'s own values and applies to every hook this deployment writes.
        </p>
      )}
      {error && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          Could not list {p.targetName}'s users: {error}
        </div>
      )}
      <select
        aria-label="Token owner"
        disabled={!users || p.replanning}
        value={p.tokenOwner ?? ''}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) p.onTokenOwner(v);
        }}
      >
        <option value="">{users ? 'Choose a user…' : 'Loading users…'}</option>
        {p.tokenOwner && users && !known && <option value={p.tokenOwner}>{p.tokenOwner}</option>}
        {(users ?? []).map((u) => (
          <option value={u.url}>{u.label}</option>
        ))}
      </select>
      {p.replanning && <p class={styles.muted}>Planning again with this owner{'…'}</p>}
      {p.replanError && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          {p.replanError}
        </div>
      )}
    </div>
  );
}

export default function Review(p: Props) {
  const { plan, result, log } = p.planned;
  const missing = tokenOwnerMissing(p.planned, p.tokenOwner);
  const w = writeList(plan);
  const edited = p.overwritten;
  const sent = w.create.length + w.update.length + w.delete.length + w.conflict.length;
  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.wzH}>
        <h1>Review the changes to {p.targetName}</h1>
        <p>
          {sent
            ? `Write sends ${sent} ${sent === 1 ? 'change' : 'changes'} to ${p.targetName}.`
            : `Write sends nothing to ${p.targetName}.`}
        </p>
      </div>
      <div class={styles.review}>
        <div class={styles.objs}>
          {p.planned.tokenOwner && (
            <div aria-label="Written to the target's own values">
              <div class={styles.gh}>Own values</div>
              <ul class={styles.counts}>
                <li>hooks."*" token_owner = {p.planned.tokenOwner}</li>
              </ul>
            </div>
          )}
          <Group title="Created" items={w.create} />
          <Group title="Updated" items={w.update} />
          <Group
            title="Deleted"
            items={w.delete}
            hint={`rdc asks before it deletes anything from ${p.targetName}.`}
          />
          <Group
            title="Both changed"
            items={w.conflict}
            hint={`Changed in ${p.sourceName} and in ${p.targetName}; rdc asks which to keep.`}
          />
          <Group
            title="Read back"
            items={w.pull}
            hint={`Changed in ${p.targetName}; read, not sent.`}
          />
          {plan.recovered.length > 0 && (
            <div aria-label="Finished from an earlier deployment">
              <div class={styles.gh}>
                Finished from an earlier deployment ({plan.recovered.length})
              </div>
              <ul class={styles.counts}>
                {plan.recovered.map((r) => (
                  <li>
                    {name(r)}
                    {r.id === null ? ' (created anew)' : ` (id ${r.id})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div class={styles.diffp}>
          <TokenOwner {...p} />
          {edited.length > 0 && (
            <div class={styles.decide} role="alert" aria-label="Overwritten direct edits">
              <div class={styles.q}>
                Changed directly in {p.targetName} since the last deployment. This deployment
                replaces them with {p.sourceName}'s version:
              </div>
              <ul class={styles.counts}>
                {edited.map((o) => (
                  <li>{o}</li>
                ))}
              </ul>
            </div>
          )}
          {[...result.warnings, ...plan.problems].map((t) => (
            <div class={styles.note} role="note">
              {t}
            </div>
          ))}
          <details>
            <summary>rdc's log of the plan</summary>
            <div class={styles.term}>
              {log.map((l) => (
                <LogLine line={l} />
              ))}
            </div>
          </details>
        </div>
      </div>
      <div class={styles.foot}>
        <button class="btn btn-secondary" onClick={p.onBack}>
          Back
        </button>
        <span class={styles.sp}></span>
        <button class="btn btn-secondary" onClick={p.onCancel}>
          Cancel
        </button>
        <button
          class="btn btn-primary"
          disabled={missing || p.replanning}
          title={missing ? "Choose who owns the hooks' tokens first" : undefined}
          onClick={p.onNext}
        >
          Continue to write
        </button>
      </div>
    </div>
  );
}
