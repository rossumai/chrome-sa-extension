// src/cib/components/TargetStep.tsx
// Step 1: the release, target and token owner. Everything read, only the owner is chosen.
import { h, Fragment } from 'preact';
import Step from './Step.jsx';
import OwnerCombobox from './OwnerCombobox.jsx';
import type { Owner } from './OwnerCombobox.jsx';
import type { Target } from '../cib.js';
import { CIB_REPO } from '../release.js';
import styles from './App.module.css';

export default function TargetStep({
  release,
  resumeRelease,
  runId,
  target,
  targetErrors,
  query,
  owner,
  label,
  owners,
  state,
  onQuery,
  onPick,
}: {
  release: string;
  resumeRelease: string | null;
  runId: string;
  target: Target | null;
  targetErrors: string[];
  query: string;
  owner: string;
  label: string;
  owners: Owner[];
  state: 'complete' | 'current' | 'optional' | undefined;
  onQuery: (q: string) => void;
  onPick: (u: Owner) => void;
}) {
  const shownRelease = resumeRelease ?? release;
  return (
    <Step
      n={1}
      state={state}
      title="Target and token owner"
      sub="The release, organization and region are read for you. Choose the admin the hooks run as."
    >
      {targetErrors.map((e) => (
        <div class={styles.errorBox} data-target-error>
          <span>{e}</span>
        </div>
      ))}
      <dl class={styles.target}>
        <div data-help="release">
          <dt>Release</dt>
          <dd class={styles.targetValue}>
            {shownRelease || '…'}
            {shownRelease && shownRelease === release && <span class={styles.latest}>latest</span>}
          </dd>
          <dd
            class={styles.hint}
            title={
              resumeRelease
                ? `Run ${runId.trim()} was started with ${resumeRelease} and resumes with it`
                : undefined
            }
          >
            {resumeRelease ? 'From checkpoint' : 'Latest on GitHub'}
            {shownRelease && (
              <>
                {' · '}
                <a
                  href={`https://github.com/${CIB_REPO}/releases/tag/${shownRelease}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  notes ↗
                </a>
              </>
            )}
          </dd>
        </div>
        <div data-help="org">
          <dt>Organization</dt>
          <dd class={styles.targetValue}>
            {target ? target.orgName : '…'}
            {target && <code>{target.orgId}</code>}
          </dd>
          <dd class={styles.hint}>From your session</dd>
        </div>
        <div data-help="region">
          <dt>Region</dt>
          <dd class={styles.targetValue}>{target ? target.region : '…'}</dd>
          <dd class={styles.hint}>From the organization group</dd>
        </div>
      </dl>
      <OwnerCombobox
        query={query}
        owner={owner}
        label={label}
        owners={owners}
        orgId={target ? String(target.orgId) : ''}
        onQuery={onQuery}
        onPick={onPick}
      />
    </Step>
  );
}
