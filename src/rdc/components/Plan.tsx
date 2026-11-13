// Step 3: what to bring from the source. Each choice plans again on a scratch copy of the read's
// project (`new Project(files)`, with no Data Storage state, so nothing is saved): the migrate
// runs for real there, then a dry-run sync of the target answers rdc's plan of exactly what Write
// would send to the org, unpushed leftovers of an earlier write included. The read's project is
// not touched until Write.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { SOURCE_ENV, TARGET_ENV } from '../deploy.js';
import { migrateOptions, writeList, type PlanChoice, type Planned } from '../plan.js';
import { runPlan } from '../runPlan.js';
import type { RdcProject } from '../wasm.js';
import { LogLine } from './Log.jsx';
import Wip from './Wip.jsx';
import { explainRunError } from '../runs.js';
import styles from './Deploy.module.css';

type Props = {
  project: RdcProject | null;
  // A scratch copy of the read's project, to plan on.
  copy: () => RdcProject;
  // The hooks' token owner to plan with (Review asks for it), or null.
  tokenOwner: string | null;
  // rdc keeps its sync state in the orgs; without it nothing may be written (design §3).
  persisted: boolean;
  sourceName: string;
  targetName: string;
  choice: PlanChoice;
  onChoice: (c: PlanChoice) => void;
  // The plan for `choice`, kept by the page so Back from Review shows it without planning again.
  planned: Planned | null;
  onPlanned: (r: Planned | null) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
};

// Why this build cannot plan, or empty.
export function planBlock(project: RdcProject | null, persisted: boolean): string {
  if (!project || typeof project.migrate !== 'function')
    return 'This build of rdc cannot plan in the browser.';
  if (!persisted)
    return 'This build of rdc cannot keep its sync state in the org, so it cannot deploy.';
  return '';
}

// The same plan in the command line, with the chosen options.
export function cliFor(choice: PlanChoice): string[] {
  const o = migrateOptions(choice, true);
  const flags = [
    ...(o.mirror ? ['--mirror'] : []),
    ...(o.carry ?? []).map((g) => `--carry ${g}`),
  ].join(' ');
  return [
    `rdc sync ${SOURCE_ENV} --no-push`,
    `rdc sync ${TARGET_ENV} --no-push`,
    `rdc migrate ${SOURCE_ENV} ${TARGET_ENV}${flags ? ` ${flags}` : ''} --dry-run`,
  ];
}

const Choice = (p: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  disabled?: boolean;
  title: string;
  hint: string;
  onChange?: () => void;
}) => (
  <label class={styles.choice}>
    {p.type === 'radio' ? (
      <input
        type="radio"
        name={p.name}
        checked={p.checked}
        disabled={p.disabled}
        onChange={p.onChange}
      />
    ) : (
      <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={p.onChange} />
    )}
    <span>
      <b>{p.title}</b>
      <small>{p.hint}</small>
    </span>
  </label>
);

export default function Plan(props: Props) {
  const { project, persisted, sourceName, targetName, choice, onChoice, planned } = props;
  const blocked = planBlock(project, persisted);
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState('');
  // The page's words for rdc's error, decided when it arrives.
  const [hint, setHint] = useState<string | null>(null);
  const setError = (m: string) => {
    setErrorText(m);
    setHint(m ? explainRunError(m) : null);
  };
  const [log, setLog] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([choice, props.tokenOwner]);
  const [plannedFor, setPlannedFor] = useState(planned ? key : '');

  useEffect(() => {
    if (blocked || !project?.migrate || (planned && plannedFor === key)) return;
    let alive = true;
    setBusy(true);
    setError('');
    setLog([]);
    props.onPlanned(null);
    const onLog = (l: string) => {
      if (alive) setLog((x) => [...x, l]);
    };
    runPlan(props.copy, choice, props.tokenOwner, onLog)
      .then(
        (p) => {
          if (!alive) return;
          setPlannedFor(key);
          props.onPlanned(p);
        },
        (e) => alive && setError(String((e as Error)?.message || e)),
      )
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [key, attempt, blocked]);

  const set = (c: Partial<PlanChoice>) => onChoice({ ...choice, ...c });
  const carry = (g: keyof PlanChoice['carry']) => () =>
    set({ carry: { ...choice.carry, [g]: !choice.carry[g] } });
  const ready = !!planned && plannedFor === key && !busy;

  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.wzH}>
        <h1>Plan what to bring</h1>
        <p>
          Choose what to copy from {sourceName}. Planning writes nothing; it shows what Write would
          send to {targetName}.
        </p>
      </div>
      {blocked && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          {blocked}
        </div>
      )}
      {error && (
        <div class={`${styles.note} ${styles.err}`} role="alert">
          <span>
            {hint && <b>{hint} </b>}
            {error}
          </span>
          <button
            class="btn btn-secondary"
            disabled={busy}
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <div class={styles.grid2}>
        <div class={styles.panel}>
          <div class={styles.panelB}>
            <div class={styles.grpT}>From {sourceName}</div>
            <Choice
              type="radio"
              name="rdc-plan-scope"
              checked
              title="Everything"
              hint="All queues, schemas, hooks, rules and labels"
            />
            <Choice
              type="radio"
              name="rdc-plan-scope"
              checked={false}
              disabled
              title="Only what I pick"
              hint="For example one hook, for a hotfix"
            />
            <Wip feature="plan" />
            <div class={styles.grpT}>
              Things {targetName} has and {sourceName} does not
            </div>
            <Choice
              type="radio"
              name="rdc-plan-missing"
              checked={!choice.mirror}
              disabled={busy}
              title="Keep them"
              hint={`Nothing is deleted in ${targetName}`}
              onChange={() => set({ mirror: false })}
            />
            <Choice
              type="radio"
              name="rdc-plan-missing"
              checked={choice.mirror}
              disabled={busy}
              title="Delete them"
              hint={`${targetName} ends up exactly like ${sourceName}; rdc lists them and asks before it deletes`}
              onChange={() => set({ mirror: true })}
            />
            <div class={styles.grpT}>Also overwrite {targetName}'s own</div>
            <Choice
              type="checkbox"
              checked={choice.carry.scoreThresholds}
              disabled={busy}
              title="Score thresholds"
              hint={`Otherwise ${targetName} keeps its own`}
              onChange={carry('scoreThresholds')}
            />
            <Choice
              type="checkbox"
              checked={choice.carry.emailPrefixes}
              disabled={busy}
              title="Inbox addresses"
              hint="Mail to the current addresses would stop arriving"
              onChange={carry('emailPrefixes')}
            />
            <Choice
              type="checkbox"
              checked={choice.carry.automation}
              disabled={busy}
              title="Automation settings"
              hint="Automation level and spot-check share"
              onChange={carry('automation')}
            />
          </div>
        </div>
        <div class={styles.stack}>
          <div class={styles.panel} aria-label="The plan">
            <div class={styles.panelHead}>
              <h2>{busy ? `Planning${'…'}` : 'What Write would do'}</h2>
            </div>
            <div class={styles.panelB}>
              {ready && planned && (
                <ul class={styles.counts}>
                  {(() => {
                    const w = writeList(planned.plan);
                    return [
                      <li>Create {w.create.length}</li>,
                      <li>Update {w.update.length}</li>,
                      <li>Delete {w.delete.length}</li>,
                      <li>Both changed {w.conflict.length}</li>,
                    ];
                  })()}
                </ul>
              )}
              {ready &&
                planned?.result.warnings.map((w) => (
                  <div class={styles.note} role="note">
                    {w}
                  </div>
                ))}
              <div class={styles.term} aria-label="Log for the plan">
                {log.map((l) => (
                  <LogLine line={l} />
                ))}
              </div>
            </div>
          </div>
          <div class={styles.panel}>
            <div class={styles.panelHead}>
              <h2>The same plan in the command line</h2>
            </div>
            <div class={styles.panelB}>
              <div class={styles.term}>
                {cliFor(choice).map((c) => (
                  <div class={styles.logLine}>{c}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class={styles.foot}>
        <button class="btn btn-secondary" onClick={props.onBack}>
          Back
        </button>
        <span class={styles.sp}></span>
        <button class="btn btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={!ready} onClick={props.onNext}>
          Review the changes
        </button>
      </div>
    </div>
  );
}
