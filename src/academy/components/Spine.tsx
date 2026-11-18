import { h } from 'preact';
import * as store from '../store.js';
import { TRACK } from '../../training/track.js';
import {
  missionStatus,
  taskState,
  checkedCount,
  isTrackComplete,
  type Progress,
} from '../../training/progress.js';
import { openStartOverDialog } from './StartOver.jsx';
import CopyName from './CopyName.jsx';
import css from '../Academy.module.css';

export const HANDOVER = 'handover';

export default function Spine({ progress, shown }: { progress: Progress; shown: string }) {
  const { done, total } = checkedCount(TRACK, progress);
  const complete = isTrackComplete(TRACK, progress);
  return (
    <aside class={css.spine}>
      <div class={css.client}>
        <div class={css.clientLogo}>{TRACK.client.initials}</div>
        <div>
          <b class={css.clientName}>{TRACK.client.name}</b>
          <span class={css.clientSub}>Accounts payable onboarding</span>
        </div>
      </div>
      <div class={css.runLine}>
        Run <CopyName value={progress.run} inline />
      </div>
      <ol class={css.missions} aria-label="Missions">
        {TRACK.missions.map((m, i) => {
          const status = missionStatus(TRACK, progress, m.id);
          const doneTasks = m.tasks.filter((t) => taskState(progress, t.id) === 'ok').length;
          return (
            <li key={m.id}>
              <button
                type="button"
                class={css.missionBtn}
                data-status={status}
                aria-current={shown === m.id ? 'true' : undefined}
                onClick={() => {
                  store.selectedMission.value = m.id;
                }}
              >
                <span class={css.dot}>{status === 'done' ? '✓' : i + 1}</span>
                <span>
                  <span class={css.missionTitle}>{m.title}</span>
                  <span class={css.missionSub}>
                    {status === 'active'
                      ? `${doneTasks} of ${m.tasks.length} tasks done`
                      : m.summary}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            class={css.missionBtn}
            data-status={complete ? 'active' : 'locked'}
            aria-current={shown === HANDOVER ? 'true' : undefined}
            onClick={() => {
              store.selectedMission.value = HANDOVER;
            }}
          >
            <span class={css.dot}>{'★'}</span>
            <span>
              <span class={css.missionTitle}>Handover</span>
              <span class={css.missionSub}>Your completion summary</span>
            </span>
          </button>
        </li>
      </ol>
      <div class={css.spineFoot}>
        <div class={css.meter}>
          <i class={css.meterFill} style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
        {done} of {total} tasks checked in your org.
        <p class={css.pauseNote}>
          Stop whenever you like. Progress is saved in this browser and the Academy opens where you
          left off. On another computer, choose Continue an earlier run and enter{' '}
          <code>{progress.run}</code>.
        </p>
        <div class={css.spineLinks}>
          <button
            type="button"
            class={css.textBtn}
            onClick={() => {
              store.showTrainer.value = !store.showTrainer.value;
            }}
          >
            Check a colleague{'’'}s summary
          </button>
          <button type="button" class={css.textBtn} onClick={openStartOverDialog}>
            Start over
          </button>
        </div>
      </div>
    </aside>
  );
}
