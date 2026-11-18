import { h } from 'preact';
import * as store from '../store.js';
import { TRACK, namesFor, type Mission } from '../../training/track.js';
import { vendorsCsv } from '../../training/vendors.js';
import { missionStatus, currentTask, taskState, type Progress } from '../../training/progress.js';
import TaskCard from './TaskCard.jsx';
import CopyName from './CopyName.jsx';
import BuildBoard from './BuildBoard.jsx';
import css from '../Academy.module.css';

function downloadCsv() {
  const url = URL.createObjectURL(new Blob([vendorsCsv()], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'acme-vendors.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MissionView({
  mission,
  progress,
}: {
  mission: Mission;
  progress: Progress;
}) {
  const names = namesFor(progress.run);
  const index = TRACK.missions.indexOf(mission);
  const status = missionStatus(TRACK, progress, mission.id);
  const cur = currentTask(TRACK, progress);
  const next = TRACK.missions[index + 1] || null;
  const complete = status === 'done';
  const statusLine = store.checkStatus.value;
  return (
    <div>
      <div class={css.mhead}>
        <div>
          <h1 class={css.mtitle}>{mission.title}</h1>
          <p class={css.msub}>
            Mission {index + 1} of {TRACK.missions.length}. About {mission.minutes} minutes.
          </p>
        </div>
        <div class={css.mactions}>
          <button
            type="button"
            class="btn"
            disabled={store.checking.value}
            onClick={() => store.checkNow()}
          >
            {store.checking.value ? 'Checking…' : 'Check now'}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            // Always Documents, the way into every queue (Rossum has no /queues page): the
            // trainee finds their own way from there.
            onClick={() => store.openInRossum('/documents')}
          >
            Open Rossum
          </button>
        </div>
      </div>
      {statusLine && (
        <p class={`${css.status} ${store.rateLimited.value ? css.statusWarn : ''}`}>{statusLine}</p>
      )}
      {/* The rule is said once, where the first name is needed (owner, 2026-11-16); after
          Kickoff every name still carries its own copy button wherever a task uses it. */}
      {mission.id === 'kickoff' && (
        <section class={css.names} aria-label="Names for this run">
          <p class={css.namesRule}>
            <b>Use these names exactly.</b> The Academy finds your work only by its name, so an
            object named any other way {'—'} even one character off {'—'} is invisible to it, and
            its task never ticks.
          </p>
          <p class={css.namesWhy}>
            This run{'’'}s code is <code class={css.runCode}>{progress.run}</code>. Acme{'’'}s IT
            puts it in every name; copy them from here rather than typing them.
          </p>
          <div class={css.namesChips}>
            <CopyName value={names.queue} />
            <CopyName value={names.dataset} />
            <CopyName value={names.rule} />
          </div>
        </section>
      )}
      {complete && (
        <section class={css.doneNote} aria-label="Mission complete">
          <span class={css.doneTick} aria-hidden="true">
            {'✓'}
          </span>
          <p class={css.doneText}>
            <b>Mission complete.</b>{' '}
            {next
              ? `Next: ${next.title}, ${next.summary.toLowerCase()}.`
              : 'That was the last one. Your handover is ready.'}
          </p>
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => {
              store.selectedMission.value = next ? next.id : 'handover';
            }}
          >
            {next ? `Go to mission ${index + 2}` : 'Go to the handover'}
          </button>
        </section>
      )}
      <div class={css.cols}>
        <div>
          <article class={css.letter} aria-label={`Message from ${TRACK.client.contact}`}>
            <header class={css.from}>
              <span class={css.avatar}>DK</span>
              <div>
                <b class={css.fromName}>{TRACK.client.contact}</b>
                <span class={css.fromRole}>{TRACK.client.role}</span>
              </div>
              <span class={css.briefTag}>Client brief</span>
            </header>
            <blockquote class={css.quote}>
              {mission.letter.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </blockquote>
            {mission.id === 'vendors' && (
              <button type="button" class={css.attach} onClick={downloadCsv}>
                {'⤓'} acme-vendors.csv
              </button>
            )}
          </article>
          <section class={css.tasksSection} aria-label="Your tasks">
            <header class={css.tasksHead}>
              <h2 class={css.tasksTitle}>Your tasks</h2>
              <span class={css.tasksCount}>
                {mission.tasks.filter((t) => taskState(progress, t.id) === 'ok').length} of{' '}
                {mission.tasks.length} done
              </span>
            </header>
            {status === 'locked' && (
              <p class={css.lockNote}>
                Finish {TRACK.missions[index - 1]?.title} first. You can read ahead.
              </p>
            )}
            <ol class={css.tasks}>
              {mission.tasks.map((t, i) => (
                <TaskCard
                  key={t.id}
                  step={i + 1}
                  task={t}
                  progress={progress}
                  names={names}
                  current={cur?.task.id === t.id}
                />
              ))}
            </ol>
          </section>
        </div>
        <BuildBoard progress={progress} names={names} />
      </div>
    </div>
  );
}
