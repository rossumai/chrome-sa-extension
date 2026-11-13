// Step 5: write the reviewed plan into the target, and the result. Write runs
// `rdc migrate source target` for real on the read's project, then `rdc sync target`, which
// pushes. rdc keeps the target's state in the
// target's Data Storage as it goes, so a closed tab loses nothing: the next deployment recovers
// the creates that were in flight. The admin types the org's name first, every time.
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { SOURCE_ENV, TARGET_ENV, type Source } from '../deploy.js';
import { migrateOptions, readMapping, remainingAfterWrite, type PlanChoice } from '../plan.js';
import { writeTokenOwner } from '../runPlan.js';
import { saveDirectEdits, saveMapping, type DataStorage } from '../sourceStore.js';
import type { CycleOutcome, RdcProject, SkipReason, SkippedItem, SyncPlan } from '../wasm.js';
import { AskPanel, usePrompts } from './Ask.jsx';
import { LogLine } from './Log.jsx';
import Wip from './Wip.jsx';
import { explainRunError, tracked } from '../runs.js';
import styles from './Deploy.module.css';

export type WriteResult = {
  outcome: CycleOutcome;
  log: string[];
  // What the write did not send, and why, as rdc reports it.
  skipped: SkippedItem[];
  // Why the records could not be saved in the org, or empty.
  note: string;
};

type Props = {
  project: RdcProject;
  source: Source;
  targetName: string;
  choice: PlanChoice;
  dataStorage: DataStorage;
  // Paths changed directly in the target since the last deployment.
  directEdits: string[];
  // The reviewed plan: what the sync sends, so what a write wrote is it minus `skipped`.
  plan: SyncPlan | null;
  // The hooks' token owner to write into the target's overlay before the migrate, or null.
  tokenOwner: string | null;
  // Why Write cannot start yet (for example, no token owner chosen), or empty.
  blocked?: string;
  onWritten: (r: WriteResult) => void;
  // The migrate changed the tree, so the page's plan no longer describes it.
  onTreeChanged: () => void;
  onBack: () => void;
  onCancel: () => void;
};

export default function Write(p: Props) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState('');
  // The page's words for rdc's error, decided when it arrives.
  const [hint, setHint] = useState<string | null>(null);
  const setError = (m: string) => {
    setErrorText(m);
    setHint(m ? explainRunError(m) : null);
  };
  const [log, setLog] = useState<string[]>([]);
  const [lastLine, setLastLine] = useState('');
  const { ask, pending } = usePrompts();
  const confirmed = typed.trim() === p.targetName;

  const write = async () => {
    if (!confirmed || busy || !p.project.migrate || !p.plan || p.blocked) return;
    const plan = p.plan;
    setBusy(true);
    setError('');
    setLog([]);
    const lines: string[] = [];
    const onLog = (l: string) => {
      lines.push(l);
      setLog([...lines]);
      setLastLine(l);
    };
    const mapping = readMapping(p.project.files());
    try {
      // The same owner the plan was made with, the same way (`runPlan.ts`).
      writeTokenOwner(p.project, p.tokenOwner);
      const result = await tracked(
        p.project.migrate(SOURCE_ENV, TARGET_ENV, migrateOptions(p.choice, false), onLog),
      );
      p.onTreeChanged();
      const outcome = await tracked(
        p.project.sync(
          TARGET_ENV,
          // Never `allowDeletes`: rdc then lists every delete in the log and asks first.
          {},
          ask,
          onLog,
        ),
      );
      const skipped = outcome.skipped ?? [];
      let note = '';
      try {
        // Only what was written loses its warning (`remainingAfterWrite`).
        const remaining = remainingAfterWrite(p.directEdits, result, plan, skipped);
        if (remaining.length !== p.directEdits.length)
          await saveDirectEdits(p.dataStorage, remaining);
        const now = readMapping(p.project.files());
        if (now !== null && now !== mapping) await saveMapping(p.dataStorage, p.source, now);
      } catch (e) {
        note = `The deployment was written, but its records could not be saved in this org: ${String((e as Error)?.message || e)}`;
      }
      p.onWritten({ outcome, log: lines, skipped, note });
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.wzH}>
        <h1>Write to {p.targetName}</h1>
        <p>
          Only {p.targetName} is changed. rdc also keeps its sync state in {p.targetName}'s Data
          Storage.
        </p>
      </div>
      <div class={styles.grid2}>
        <div class={styles.confirm}>
          <h2>Confirm the deployment</h2>
          <p class={styles.muted}>
            You are about to change {p.targetName}. Type the org name to confirm. Every deployment
            asks for it.
          </p>
          <div class={styles.typed}>
            <input
              type="text"
              placeholder={p.targetName}
              aria-label={`Type ${p.targetName} to confirm`}
              value={typed}
              disabled={busy}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
            />
            <button
              class="btn btn-primary"
              disabled={!confirmed || busy || !p.plan || !!p.blocked}
              title={p.blocked || undefined}
              onClick={write}
            >
              Write the changes to {p.targetName}
            </button>
          </div>
          <Wip feature="secrets" />
        </div>
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>{busy ? `Writing${'…'}` : 'Writing'}</h2>
          </div>
          <div class={`${styles.panelB} ${styles.stack}`}>
            <div class={styles.note}>
              <span>
                If this tab closes during the write, nothing is lost: the next deployment finishes
                what this one started.
              </span>
            </div>
            {error && (
              <div class={`${styles.note} ${styles.err}`} role="alert">
                <span>
                  {hint && <b>{hint} </b>}
                  {error}
                </span>
              </div>
            )}
            {pending && <AskPanel pending={pending} lastLine={lastLine} />}
            <div class={styles.term} aria-label="Log for the write">
              {log.map((l) => (
                <LogLine line={l} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div class={styles.foot}>
        <button class="btn btn-secondary" disabled={busy} onClick={p.onBack}>
          Back
        </button>
        <span class={styles.sp}></span>
        <button class="btn btn-secondary" disabled={busy} onClick={p.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// rdc's skip reasons in the page's words (rdc `feat/wasm-migrate` spec §7).
const SKIP: Record<SkipReason, string> = {
  deleteGateDeclined: 'The delete was declined.',
  deleteDriftSkipped: 'Not deleted: it changed in the org, so the delete was put off.',
  pushDriftSkipped: 'Not sent: it changed in the org, so the change was put off.',
  conflictSkipped: 'Changed on both sides; skipped.',
  remoteDeleteSkipped: 'Deleted on one side; put off.',
  mdhIndexDropDeclined: 'Dropping its indexes was declined.',
  mdhRowDeleteDeclined: 'Deleting its rows was declined.',
};

export function Done({
  result,
  targetName,
  onBack,
}: {
  result: WriteResult;
  targetName: string;
  onBack: () => void;
}) {
  return (
    <div class={styles.wrap}>
      <div class={styles.finGrid}>
        <div class={styles.doneHero}>
          <h1>After the deployment</h1>
          <p class={styles.muted}>
            {result.outcome.itemsPushed} {result.outcome.itemsPushed === 1 ? 'change' : 'changes'}{' '}
            written to {targetName}
            {result.outcome.conflicts ? `, ${result.outcome.conflicts} conflicts left` : ''}.
          </p>
          {result.skipped.length > 0 && (
            <div class={`${styles.note} ${styles.err}`} role="alert" aria-label="Not written">
              <span>
                Not written to {targetName}; the direct-edit warnings stay until a deployment writes
                everything:
              </span>
              <ul class={styles.counts}>
                {result.skipped.map((i) => (
                  <li>
                    {i.kind}/{i.slug}: {SKIP[i.reason] ?? i.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.note && (
            <div class={`${styles.note} ${styles.err}`} role="alert">
              {result.note}
            </div>
          )}
          <div class={styles.foot}>
            <button class="btn btn-primary" onClick={onBack}>
              Back to {targetName}
            </button>
          </div>
        </div>
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>Left for you</h2>
          </div>
          <div class={`${styles.panelB} ${styles.stack}`}>
            <div class={styles.term} aria-label="Log for the write">
              {result.log.map((l) => (
                <LogLine line={l} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
