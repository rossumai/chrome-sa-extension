// The deployments page below the band: the first-visit card with no source, else the source,
// the history and the values the org keeps for itself (the last two are work in progress).
import { h } from 'preact';
import { hostOf, type Source } from '../deploy.js';
import Wip from './Wip.jsx';
import styles from './Deploy.module.css';

type Props = {
  source: Source | null;
  targetName: string;
  onChooseSource: () => void;
  onDeploy: () => void;
  onEditOwn: () => void;
};

export default function Overview({
  source,
  targetName,
  onChooseSource,
  onDeploy,
  onEditOwn,
}: Props) {
  if (!source) {
    return (
      <div class={styles.wrap}>
        <div class={styles.hero}>
          <div>
            <h1>Bring tested configuration into {targetName}</h1>
            <p>
              Copy queues, schemas, hooks, rules and labels from another organization into this one.
              You see every change before anything is written.
            </p>
            <ol class={styles.steps}>
              <li>Choose the one org that {targetName} deploys from, usually your test org.</li>
              <li>Give a token for it. It is only read, and the token is not kept.</li>
              <li>Review what will change in {targetName}, then write it.</li>
            </ol>
            <button class="btn btn-primary" onClick={onChooseSource}>
              Choose the org to deploy from
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div class={styles.wrap}>
      <div class={styles.ov}>
        <div class={styles.col}>
          <div class={styles.panel}>
            <div class={styles.panelH}>
              <h2>{targetName} deploys from</h2>
            </div>
            <div class={styles.src}>
              <div class={styles.badge}>{source.name.charAt(0).toUpperCase()}</div>
              <div>
                <div class={styles.srcName}>{source.name}</div>
                <div class={styles.srcMeta}>
                  {source.orgName}, org {source.orgId}, {hostOf(source.domain)}
                </div>
              </div>
              <button class="btn btn-primary" onClick={onDeploy}>
                Deploy from {source.name}
              </button>
            </div>
            <div class={styles.srcFoot}>
              {targetName} has one source.
              <button class={styles.link} onClick={onChooseSource}>
                Change source
              </button>
            </div>
            <div class={styles.panelB}>
              <Wip feature="remember" />
            </div>
          </div>
          <div class={styles.panel}>
            <div class={styles.panelH}>
              <h2>Deployments into {targetName}</h2>
            </div>
            <div class={styles.panelB}>
              <Wip feature="history" />
            </div>
          </div>
        </div>
        <div class={styles.col}>
          <div class={styles.panel}>
            <div class={styles.panelHead}>
              <h2>What {targetName} keeps for itself</h2>
              <span class={styles.sp}></span>
              <button class="btn btn-secondary" onClick={onEditOwn}>
                Edit
              </button>
            </div>
            <div class={styles.panelB}>
              <p class={styles.muted}>
                A deployment never overwrites these. Everything else comes from the source.
              </p>
              <Wip feature="ownValues" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
