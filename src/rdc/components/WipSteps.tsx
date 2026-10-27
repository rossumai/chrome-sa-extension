// Plan, Review, Write and Done, and the org's own values: the design's headings and frames, with
// the work-in-progress note where the data would be. Every control that would act on data is
// disabled; only moving between the steps works.
import { h } from 'preact';
import { SOURCE_ENV, TARGET_ENV } from '../deploy.js';
import Wip from './Wip.jsx';
import styles from './Deploy.module.css';

export type WipStepId = 'plan' | 'review' | 'write' | 'done';

type StepProps = {
  step: WipStepId;
  sourceName: string;
  targetName: string;
  onBack: () => void;
  onNext?: () => void;
};

// What the admin can run today instead of the Plan step, with rdc's env names.
const CLI = [
  `rdc sync ${SOURCE_ENV} --no-push`,
  `rdc sync ${TARGET_ENV} --no-push`,
  `rdc migrate ${SOURCE_ENV} ${TARGET_ENV}`,
  `rdc sync ${TARGET_ENV} --dry-run`,
];

const Choice = (p: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked?: boolean;
  title: string;
  hint: string;
}) => (
  <label class={styles.choice}>
    {p.type === 'radio' ? (
      <input type="radio" name={p.name} checked={p.checked} disabled />
    ) : (
      <input type="checkbox" checked={p.checked} disabled />
    )}
    <span>
      <b>{p.title}</b>
      <small>{p.hint}</small>
    </span>
  </label>
);

function Plan({ sourceName, targetName }: { sourceName: string; targetName: string }) {
  return (
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
            title="Only what I pick"
            hint="For example one hook, for a hotfix"
          />
          <div class={styles.grpT}>
            Things {targetName} has and {sourceName} does not
          </div>
          <Choice
            type="radio"
            name="rdc-plan-missing"
            checked
            title="Keep them"
            hint={`Nothing is deleted in ${targetName}`}
          />
          <Choice
            type="radio"
            name="rdc-plan-missing"
            title="Delete them"
            hint={`${targetName} ends up exactly like ${sourceName}`}
          />
          <div class={styles.grpT}>Also overwrite {targetName}'s own</div>
          <Choice
            type="checkbox"
            title="Score thresholds"
            hint={`Otherwise ${targetName} keeps its own`}
          />
          <Choice
            type="checkbox"
            title="Inbox addresses"
            hint="Mail to the current addresses would stop arriving"
          />
          <Choice
            type="checkbox"
            title="Automation settings"
            hint="Automation level and spot-check share"
          />
        </div>
      </div>
      <div class={styles.stack}>
        <Wip feature="plan" />
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>The same plan in the command line</h2>
          </div>
          <div class={styles.panelB}>
            <div class={styles.term}>
              {CLI.map((c) => (
                <div class={styles.logLine}>{c}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Review({ sourceName, targetName }: { sourceName: string; targetName: string }) {
  return (
    <div class={styles.review}>
      <div class={styles.objs}>
        <div class={styles.gh}>Needs your decision</div>
        <div class={styles.gh}>Hooks</div>
        <div class={styles.gh}>Queues and schemas</div>
        <div class={styles.gh}>Rules</div>
      </div>
      <div class={styles.diffp}>
        <Wip feature="review" />
        <div class={styles.decide}>
          <div class={styles.q}>
            Both orgs changed this. Which version should {targetName} have?
          </div>
          <div class={styles.opts}>
            <button disabled>
              <span>Use {sourceName}'s version</span>
              <small>{targetName}'s edit is replaced</small>
            </button>
            <button disabled>
              <span>Keep {targetName}'s version</span>
              <small>{sourceName}'s change is not applied</small>
            </button>
            <button disabled>
              <span>Decide next time</span>
              <small>Skip it in this deployment</small>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Write({ targetName, onNext }: { targetName: string; onNext?: () => void }) {
  return (
    <div class={styles.grid2}>
      <div class={styles.confirm}>
        <h2>Confirm the deployment</h2>
        <p class={styles.muted}>
          You are about to change {targetName}. Type the org name to confirm. Every deployment asks
          for it.
        </p>
        <div class={styles.typed}>
          <input
            type="text"
            placeholder={targetName}
            aria-label={`Type ${targetName} to confirm`}
            disabled
          />
          <button class="btn btn-primary" disabled>
            Write the changes to {targetName}
          </button>
        </div>
      </div>
      <div class={styles.panel}>
        <div class={styles.panelHead}>
          <h2>Writing</h2>
        </div>
        <div class={`${styles.panelB} ${styles.stack}`}>
          <Wip feature="write" />
          <div class={styles.note}>
            <span>
              <b>Keep this tab open until the deployment finishes.</b> Closing it stops the
              deployment, and the changes already written stay in {targetName}.
            </span>
          </div>
          {/* nothing was written, so there is no result to see until writing works */}
          <div class={styles.foot}>
            <span class={styles.sp}></span>
            <button class="btn btn-secondary" disabled onClick={onNext}>
              See the result
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const HEAD: Record<WipStepId, (src: string, dst: string) => [string, string]> = {
  plan: (src) => ['Plan what to bring', `Choose what to copy from ${src}.`],
  review: (_src, dst) => [
    `Review the changes to ${dst}`,
    `Red lines leave ${dst}, green lines arrive in ${dst}. Lines marked "${dst} keeps this" are ${dst}'s own values and do not change.`,
  ],
  write: (_src, dst) => [`Write to ${dst}`, `Only ${dst} is changed.`],
  done: (_src, dst) => [
    'After the deployment',
    `What changed in ${dst}, and what is left for you.`,
  ],
};

const NEXT: Partial<Record<WipStepId, string>> = {
  plan: 'Review the changes',
  review: 'Continue to write',
};

export function WipStep({ step, sourceName, targetName, onBack, onNext }: StepProps) {
  const [title, lead] = HEAD[step](sourceName, targetName);
  if (step === 'done') {
    return (
      <div class={styles.wrap}>
        <div class={styles.finGrid}>
          <div class={styles.doneHero}>
            <h1>{title}</h1>
            <p class={styles.muted}>{lead}</p>
            <Wip feature="write" />
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
            <div class={styles.panelB}>
              <Wip feature="review" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  const next = NEXT[step];
  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.wzH}>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      {step === 'plan' && <Plan sourceName={sourceName} targetName={targetName} />}
      {step === 'review' && <Review sourceName={sourceName} targetName={targetName} />}
      {step === 'write' && <Write targetName={targetName} onNext={onNext} />}
      <div class={styles.foot}>
        <button class="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <span class={styles.sp}></span>
        {next && onNext && (
          <button class="btn btn-primary" onClick={onNext}>
            {next}
          </button>
        )}
      </div>
    </div>
  );
}

// The groups rdc keeps for the target unless one deployment's Plan says otherwise.
const ALWAYS: [string, string][] = [
  ['Score thresholds of fields and queues', 'kept'],
  ['Inbox addresses', 'kept'],
  ['Automation level and spot-check share', 'kept'],
  ['Queue training', 'always kept'],
];

export function OwnValues({ targetName, onBack }: { targetName: string; onBack: () => void }) {
  return (
    <div class={`${styles.wrap} ${styles.wz}`}>
      <div class={styles.backRow}>
        <button class={styles.link} onClick={onBack}>
          {'← '}
          {targetName}
        </button>
      </div>
      <div class={`${styles.wzH} ${styles.wzRow}`}>
        <div>
          <h1>What {targetName} keeps for itself</h1>
          <p>
            A deployment copies everything from the source except these values. Use them for what
            must differ in {targetName}: addresses of other systems, users, mail addresses.
          </p>
        </div>
        <span class={styles.sp}></span>
        <button class="btn btn-primary" disabled>
          Save changes
        </button>
      </div>
      <div class={styles.panel}>
        <div class={styles.panelHead}>
          <h2>Values you set</h2>
        </div>
        <div class={`${styles.panelB} ${styles.stack}`}>
          <table class={styles.ownt}>
            <thead>
              <tr>
                <th>Object</th>
                <th>Setting</th>
                <th>Value in {targetName}</th>
                <th>Value in the source</th>
              </tr>
            </thead>
          </table>
          <Wip feature="ownValues" />
          <div class={styles.addv}>
            <select aria-label="Object" disabled>
              <option>Choose an object{'…'}</option>
            </select>
            <select aria-label="Setting" disabled>
              <option>Choose a setting{'…'}</option>
            </select>
            <button class="btn btn-secondary" disabled>
              Add value
            </button>
          </div>
        </div>
      </div>
      <div class={`${styles.grid2} ${styles.spaced}`}>
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>Always {targetName}'s own</h2>
          </div>
          <div class={styles.panelB}>
            <p class={styles.muted}>
              These stay as they are in {targetName}. A single deployment can still overwrite them,
              in its Plan step.
            </p>
            <div class={styles.pins}>
              {ALWAYS.map(([what, tag]) => (
                <div>
                  <span>{what}</span>
                  <span class={styles.pinTag}>{tag}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div class={styles.panel}>
          <div class={styles.panelHead}>
            <h2>Hook secrets</h2>
          </div>
          <div class={styles.panelB}>
            <p class={styles.muted}>
              Secrets are not listed here. Rossum never shows them, and the Console never stores
              them. You type a secret during a deployment, only when {targetName} needs a new one.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
