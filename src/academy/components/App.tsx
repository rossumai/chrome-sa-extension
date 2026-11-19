import { h } from 'preact';
import { useState } from 'preact/hooks';
import * as store from '../store.js';
import { TRACK } from '../../training/track.js';
import { currentMission, currentTask, isTrackComplete } from '../../training/progress.js';
import Spine, { HANDOVER } from './Spine.jsx';
import MissionView from './MissionView.jsx';
import Handover from './Handover.jsx';
import TrainerPanel from './TrainerPanel.jsx';
import Modal from '../../ui/Modal.jsx';
import css from '../Academy.module.css';
import ctl from '../../ui/controls.module.css';
import es from '../../ui/EmptyState.module.css';
import shell from '../../ui/AppShell.module.css';

// store.error is set by start, restart and init; a failed write must say so.
function ErrorStrip() {
  const message = store.error.value;
  if (!message) return null;
  return (
    <div class={css.errorStrip} role="alert">
      <span>{message}</span>
      <button
        type="button"
        class={css.errorDismiss}
        aria-label="Dismiss"
        onClick={() => {
          store.error.value = null;
        }}
      >
        {'×'}
      </button>
    </div>
  );
}

// For another computer, or a browser whose storage was cleared: progress lives in
// this browser, the run's objects in the org, so the code is all it takes.
function ContinueRun() {
  const [code, setCode] = useState('');
  return (
    <form
      class={css.continueRun}
      onSubmit={(e) => {
        e.preventDefault();
        store.continueRun(code);
      }}
    >
      <label class={css.continueLabel} for="academy-run-code">
        Continue an earlier run
      </label>
      <p class={css.continueHint}>
        On another computer, or after clearing this browser? Enter the run{'’'}s code, and the
        Academy finds what you built and picks up where you left off.
      </p>
      <div class={css.continueRow}>
        <input
          id="academy-run-code"
          class={css.continueInput}
          placeholder="barge-17"
          value={code}
          onInput={(e) => setCode(e.currentTarget.value)}
        />
        <button type="submit" class={ctl.btn} disabled={!code.trim()}>
          Continue
        </button>
      </div>
    </form>
  );
}

function Landing() {
  return (
    <div class={css.entry}>
      <div class={css.landing}>
        <div>
          <div class={css.client}>
            <div class={css.clientLogo}>{TRACK.client.initials}</div>
            <div>
              <b class={css.clientName}>{TRACK.client.name}</b>
              <span class={css.clientSub}>A fictional client, and your first project</span>
            </div>
          </div>
          <h1 class={css.landingTitle}>{TRACK.title}</h1>
          <p class={css.landingLede}>
            Acme Freight wants its supplier invoices to reach the ERP with the right vendor, and
            without anyone typing them. You build it, in your own organization.
          </p>
          <p class={css.landingBody}>
            Six missions take you from an empty queue to one invoice confirmed end to end. Each run
            gets its own code, and everything you build carries it in Acme{'’'}s naming convention,
            so the Academy knows what belongs to this run. The Academy only reads your organization,
            unless you start over and ask it to delete a run.
          </p>
          <ErrorStrip />
          <div class={css.landingActions}>
            <button
              type="button"
              class={`${ctl.btn} ${ctl.btnPrimary}`}
              onClick={() => store.startTrack()}
            >
              Start the project
            </button>
            <button
              type="button"
              class={css.textBtn}
              onClick={() => {
                store.showTrainer.value = !store.showTrainer.value;
              }}
            >
              Check a colleague{'’'}s summary
            </button>
          </div>
        </div>
        <div>
          <ol class={css.landingList}>
            {TRACK.missions.map((m, i) => (
              <li key={m.id} class={css.landingItem}>
                <span class={css.dot}>{i + 1}</span>
                <span>
                  <span class={css.landingItemTitle}>{m.title}</span>
                  <span class={css.missionSub}>
                    {m.summary}. About {m.minutes} minutes.
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <ContinueRun />
        </div>
      </div>
      {store.showTrainer.value && <TrainerPanel />}
    </div>
  );
}

export default function AcademyApp({ connected }: { connected: boolean | null }) {
  const progress = store.progress.value;
  if (!connected) {
    return (
      <div class={shell.root}>
        <div class={css.entry}>
          <div class={es.root}>
            <div class={es.card}>
              <div class={es.title}>Not connected</div>
              <p class={es.body}>
                {store.error.value ||
                  'Open the Console from the extension popup on a Rossum tab to start the Academy.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!progress) return <Landing />;

  const selected = store.selectedMission.value;
  const complete = isTrackComplete(TRACK, progress);
  // Follow the task to work on: an earlier mission when its work was undone since.
  const shown =
    selected ||
    (complete
      ? HANDOVER
      : (currentTask(TRACK, progress)?.mission ?? currentMission(TRACK, progress)!).id);
  const mission = TRACK.missions.find((m) => m.id === shown);
  return (
    <div class={css.root}>
      <Spine progress={progress} shown={shown} />
      <main class={css.main}>
        <ErrorStrip />
        {mission ? (
          <MissionView mission={mission} progress={progress} />
        ) : (
          <Handover progress={progress} />
        )}
        {store.showTrainer.value && <TrainerPanel />}
      </main>
      <Modal />
    </div>
  );
}
